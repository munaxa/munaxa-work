import { success, type Query, type QueryHandler } from '@work/kernel';

import { recordAccessFor } from './access-recording.js';
import { notFound } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import { violationCategoryView, violationView } from './relations-views.js';
import type { RelationsDependencies } from './relations-dependencies.js';
import type {
  ViolationCategoryView,
  ViolationPageView,
  ViolationView,
} from '../contracts/views.js';

/**
 * The reads, and the three rules every one of them keeps.
 *
 * **Reading a violation is recorded; reading the catalogue is not.** That line is AD-007 applied
 * rather than approximated: a violation is a disciplinary record about a named employment, and a
 * catalogue is the list of words a policy is written in. Auditing both would bury the reads that
 * matter under reads that never mattered, which is the "audit every query" mechanism the approval
 * forbids (D-5.2-05).
 *
 * **Bounded, and never tenant-wide.** The only collection read of violations takes an *employment*.
 * There is no published way to list a tenant's disciplinary matters at large — that is a report
 * nobody approved, and it is the kind of read that turns a case-file system into a watchlist.
 *
 * **Nothing found rather than forbidden.** A violation in another tenant answers exactly as one that
 * never existed, so an identifier cannot be used as a probe.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly pageSize?: number;
}

const pagedFrom = (request: PageRequest): { readonly limit: number; readonly offset: number } => {
  const size = boundedSize(request.pageSize);
  const page =
    request.page !== undefined && Number.isInteger(request.page) && request.page > 0
      ? request.page
      : 1;

  return { limit: size, offset: (page - 1) * size };
};

const boundedSize = (size: number | undefined): number => {
  if (size === undefined || !Number.isInteger(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAXIMUM_PAGE_SIZE);
};

/** The tenant's catalogue, ordered `(sequence, code)`. Inactive entries on request, never by default. */
export interface ListViolationCategories extends Query {
  readonly queryName: 'relations.categories';
  readonly includeInactive?: boolean;
}

export const listViolationCategoriesHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ListViolationCategories, readonly ViolationCategoryView[]> => ({
  queryName: 'relations.categories',
  permission: RelationsPermissions.categoryRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.categories.all(
        transaction,
        query.includeInactive ?? false,
      );

      // No access event: a catalogue names nobody. See the note at the top of this file.
      return success(found.map(violationCategoryView));
    }),
});

export interface ReadViolation extends Query {
  readonly queryName: 'relations.read-violation';
  readonly violationId: string;
}

export const readViolationHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadViolation, ViolationView> => ({
  queryName: 'relations.read-violation',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.violations.byId(transaction, query.violationId);

      // Recorded only for a violation that was actually disclosed. A miss discloses nothing, and an
      // event for one would let a caller write into the trail by guessing identifiers.
      if (held === undefined) return notFound<ViolationView>('violation');

      await recordAccessFor(dependencies, transaction, {
        violationId: held.violationId,
        action: 'violation_read',
      });
      return success(violationView(held));
    }),
});

export interface ListViolationsForEmployment extends Query, PageRequest {
  readonly queryName: 'relations.violations';
  readonly employmentId: string;
}

export const listViolationsHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ListViolationsForEmployment, ViolationPageView> => ({
  queryName: 'relations.violations',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.violations.forEmployment(
        transaction,
        query.employmentId,
        pagedFrom(query),
      );

      // One event per record disclosed, not one per query. AD-007 audits reads *of a record*, and a
      // single event for a page would leave which records were seen unanswerable — which is the
      // question the trail exists to answer. The page is bounded, so the write is bounded with it.
      for (const violation of found.items) {
        await recordAccessFor(dependencies, transaction, {
          violationId: violation.violationId,
          action: 'violation_listed',
        });
      }
      return success({ items: found.items.map(violationView), total: found.total });
    }),
});
