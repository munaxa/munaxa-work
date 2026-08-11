import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
  type Transaction,
} from '@work/kernel';

import { inForceOn } from '../domain/versioned-child.js';
import { statusOn } from '../domain/status-record.js';
import type { EmploymentState } from '../domain/employment.js';
import type {
  EmploymentHistoryView,
  EmploymentSnapshot,
  EmploymentView,
} from '../contracts/views.js';

import { notFound } from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import { loadEmployment } from './employment-guard.js';
import {
  assignmentView,
  byEffectiveFrom,
  contractView,
  employmentView,
  reportingLineView,
  statusRecordView,
  type NameResolver,
} from './employment-views.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Reading the workforce.
 *
 * **Every read is as at a date.** Omitting `asOf` means today; supplying it renders the placement,
 * the manager and the contract in force then. That is not a convenience — an employment's
 * department is a fact about a date, and a product whose reads only knew "now" could not answer
 * the question a payroll re-run or an audit actually asks.
 *
 * **Names are resolved through People, once per page.** The resolver is built by asking People's
 * published query for each person on the page, so the redaction People applies is the redaction
 * this module inherits. It is bounded by the page size rather than by the size of the register —
 * and the batched read that would make it one round trip is a change to People this phase was
 * directed not to make. Recorded as debt with the measurement rather than hidden.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface SearchEmployments extends Query {
  readonly queryName: 'employment.search';
  /** Matches the employment number and the customer's own number. Never a person's name. */
  readonly term?: string;
  readonly status?: string;
  readonly personId?: string;
  readonly employmentTypeCode?: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly managerEmploymentId?: string;
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

export const searchEmploymentsHandler = (
  dependencies: EmploymentDependencies,
): QueryHandler<SearchEmployments, PagedResult<EmploymentView>> => ({
  queryName: 'employment.search',
  permission: EmploymentPermissions.employmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const asOf = query.asOf ?? dependencies.clock.now();
      const found = await dependencies.stores.employments.search(transaction, {
        limit: size,
        offset: (page - 1) * size,
        asOf,
        ...filtersOf(query),
      });
      const views = await viewsFor(transaction, dependencies, found.items, asOf);

      return success(pagedResult(views, page, size, found.total));
    }),
});

const filtersOf = (query: SearchEmployments): Record<string, string> => ({
  ...(query.term === undefined ? {} : { term: query.term }),
  ...(query.status === undefined ? {} : { status: query.status }),
  ...(query.personId === undefined ? {} : { personId: query.personId }),
  ...(query.employmentTypeCode === undefined
    ? {}
    : { employmentTypeCode: query.employmentTypeCode }),
  ...(query.unitId === undefined ? {} : { unitId: query.unitId }),
  ...(query.positionId === undefined ? {} : { positionId: query.positionId }),
  ...(query.costCenterId === undefined ? {} : { costCenterId: query.costCenterId }),
  ...(query.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: query.managerEmploymentId }),
});

/**
 * Builds one page's views, resolving each employment's timelines and each person's name.
 *
 * The timelines are read for the whole page in one query rather than per row — an employment list
 * that fetched assignments per employment is the N+1 §45 forbids, and it is the easiest one in
 * this module to write by accident.
 */
const viewsFor = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  states: readonly EmploymentState[],
  asOf: Date,
): Promise<readonly EmploymentView[]> => {
  if (states.length === 0) return [];

  const ids = states.map((state) => state.id);
  const assignments = await dependencies.stores.assignments.forEmployments(transaction, ids);
  const reportingLines = await dependencies.stores.reportingLines.forEmployments(transaction, ids);
  const nameOf = await nameResolverFor(dependencies, states, asOf);

  return states.map((state) =>
    employmentView(
      state,
      asOf,
      {
        assignments: assignments.filter((row) => row.employmentId === state.id),
        reportingLines: reportingLines.filter((row) => row.employmentId === state.id),
      },
      nameOf,
    ),
  );
};

/**
 * Resolves the names on a page, through People's published query.
 *
 * One lookup per distinct person on the page. A caller who may not read people gets a resolver
 * that finds nothing, and the views carry no name — which is the behaviour a directory needs: a
 * list that refused the whole page because one field is restricted is a list nobody can use.
 */
const nameResolverFor = async (
  dependencies: EmploymentDependencies,
  states: readonly EmploymentState[],
  asOf: Date,
): Promise<NameResolver> => {
  const names = new Map<string, Readonly<Record<string, string>>>();
  const personIds = [...new Set(states.map((state) => state.personId))];

  for (const personId of personIds) {
    const person = await dependencies.people.find(personId, asOf);

    if (person?.legalName !== undefined) names.set(personId, person.legalName);
  }
  return (personId) => names.get(personId);
};

export interface ReadEmployment extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  readonly asOf?: Date;
}

/**
 * One employment as it stood on a date.
 *
 * `statusOn` is reconstructed from the status history rather than read from the employment row.
 * The row answers "now"; the history answers "then", and conflating them is exactly what a single
 * mutable status column does to a product that has to answer both (§22).
 */
export const readEmploymentHandler = (
  dependencies: EmploymentDependencies,
): QueryHandler<ReadEmployment, EmploymentSnapshot> => ({
  queryName: 'employment.read-employment',
  permission: EmploymentPermissions.employmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadEmployment(transaction, dependencies.stores, query.employmentId);

      if (!loaded.ok) return loaded;

      const asOf = query.asOf ?? dependencies.clock.now();
      const { assignments, reportingLines, contracts, history } = await timelinesOf(
        transaction,
        dependencies,
        query.employmentId,
      );
      const nameOf = await nameResolverFor(dependencies, [loaded.value], asOf);
      const line = inForceOn(
        reportingLines.filter((reporting) => reporting.lineType === 'primary'),
        asOf,
      )?.value;
      const contract = inForceOn(contracts, asOf)?.value;
      const status = statusOn(history, asOf);

      return success({
        asOf,
        employment: employmentView(loaded.value, asOf, { assignments, reportingLines }, nameOf),
        assignments: assignments
          .filter(
            (assignment) =>
              assignment.effectiveFrom.getTime() <= asOf.getTime() &&
              (assignment.effectiveTo === undefined ||
                assignment.effectiveTo.getTime() > asOf.getTime()),
          )
          .map(assignmentView),
        ...(line === undefined ? {} : { reportingLine: reportingLineView(line) }),
        ...(contract === undefined ? {} : { contract: contractView(contract) }),
        ...(status === undefined ? {} : { statusOn: status }),
      });
    }),
});

export interface ReadEmploymentHistory extends Query {
  readonly queryName: 'employment.read-history';
  readonly employmentId: string;
}

/**
 * Every timeline of one employment, whole.
 *
 * Returned together because they are read together: how an employment came to be the way it is is
 * one question, and answering it in four round trips is four chances for a screen to show a
 * manager from one date beside a department from another.
 */
export const readEmploymentHistoryHandler = (
  dependencies: EmploymentDependencies,
): QueryHandler<ReadEmploymentHistory, EmploymentHistoryView> => ({
  queryName: 'employment.read-history',
  permission: EmploymentPermissions.historyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.stores.employments.byId(
        transaction,
        query.employmentId,
      );

      if (employment === undefined) return notFound<EmploymentHistoryView>('employment');

      const { assignments, reportingLines, contracts, history } = await timelinesOf(
        transaction,
        dependencies,
        query.employmentId,
      );

      return success({
        employmentId: query.employmentId,
        statusHistory: [...history]
          .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())
          .map(statusRecordView),
        assignments: [...assignments].sort(byEffectiveFrom).map(assignmentView),
        reportingLines: [...reportingLines].sort(byEffectiveFrom).map(reportingLineView),
        contracts: [...contracts].sort(byEffectiveFrom).map(contractView),
      });
    }),
});

/** Every timeline of one employment, in four reads rather than four per row. */
const timelinesOf = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  employmentId: string,
) => ({
  assignments: await dependencies.stores.assignments.forEmployment(transaction, employmentId),
  reportingLines: await dependencies.stores.reportingLines.forEmployment(transaction, employmentId),
  contracts: await dependencies.stores.contracts.forEmployment(transaction, employmentId),
  history: await dependencies.stores.statusHistory.forEmployment(transaction, employmentId),
});
