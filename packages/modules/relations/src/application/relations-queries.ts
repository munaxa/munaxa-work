import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { recordAccessFor } from './access-recording.js';
import { occurrenceOf, windowStart } from '../domain/escalation.js';
import { mayReadFindings } from './findings-visibility.js';
import { notFound } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import {
  caseHistoryView,
  investigationView,
  violationCategoryView,
  violationView,
} from './relations-views.js';
import type { ViolationRecord } from '../domain/violation.js';
import type { RelationsDependencies } from './relations-dependencies.js';
import type {
  CaseHistoryView,
  InvestigationPageView,
  InvestigationView,
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

      return success(violationView(held, await occurrenceFor(dependencies, transaction, held)));
    }),
});

/**
 * Where one violation sits in its own repeat window — derived here, stored nowhere.
 *
 * **The list read does not carry it**, deliberately: an ordinal per row would mean a category read
 * and a window query per item, and a page of fifty would become fifty-one queries to decorate a list
 * nobody counts from. The single read carries it, which is where the question is actually asked.
 *
 * Absent when the category cannot be read — never defaulted to 1. See `violationView`.
 */
const occurrenceFor = async (
  dependencies: RelationsDependencies,
  transaction: Transaction,
  violation: ViolationRecord,
): Promise<number | undefined> => {
  const category = await dependencies.stores.categories.byId(
    transaction,
    violation.violationCategoryId,
  );

  if (category === undefined) return undefined;

  const from = windowStart(violation.occurredOn, category.repeatWindowDays);
  const violations = await dependencies.stores.violations.inCategoryWindow(
    transaction,
    violation.employmentId,
    violation.violationCategoryId,
    { from, to: violation.occurredOn },
  );

  return occurrenceOf(violation, category.repeatWindowDays, violations);
};

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

/**
 * One investigation, by identifier.
 *
 * Audited like a violation read and for the same reason: findings and a recommendation are the most
 * sensitive text this module holds, and AD-007 audits reading a disciplinary record rather than
 * reading a violation table specifically. The access event is keyed by the **violation**, so "who has
 * been looking at this case" is one question answered from one trail.
 *
 * **A concluded inquiry is `not_found` to a caller without `relations.investigation.read-findings`**
 * (D-5.2-18, approved). Fetching one by identifier is asking for what it found, so a partial answer
 * would be an odd contract and a `forbidden` would confirm that findings exist about somebody —
 * which in this domain is itself the disclosure. An *open* inquiry is returned normally: it has
 * concluded nothing, so there is nothing being withheld.
 *
 * **The access event is written only for what was actually disclosed.** A caller refused the
 * findings did not read the record, so no event is written — an audit trail that recorded reads
 * which did not happen would answer its own question wrongly.
 */
export interface ReadInvestigation extends Query {
  readonly queryName: 'relations.read-investigation';
  readonly investigationId: string;
}

export const readInvestigationHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadInvestigation, InvestigationView> => ({
  queryName: 'relations.read-investigation',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.investigations.byId(
        transaction,
        query.investigationId,
      );

      if (held === undefined) return notFound<InvestigationView>('investigation');

      const withFindings = await mayReadFindings(dependencies);

      if (held.state === 'concluded' && !withFindings) {
        return notFound<InvestigationView>('investigation');
      }

      await recordAccessFor(dependencies, transaction, {
        violationId: held.violationId,
        action: 'investigation_read',
      });
      return success(investigationView(held, withFindings));
    }),
});

/** The inquiries into one violation. Bounded, and never tenant-wide — like every list here. */
export interface ListInvestigations extends Query, PageRequest {
  readonly queryName: 'relations.investigations';
  readonly violationId: string;
}

export const listInvestigationsHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ListInvestigations, InvestigationPageView> => ({
  queryName: 'relations.investigations',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.investigations.forViolation(
        transaction,
        query.violationId,
        pagedFrom(query),
      );

      // One event per record disclosed, as for violations — and only when something was disclosed.
      for (const investigation of found.items) {
        await recordAccessFor(dependencies, transaction, {
          violationId: investigation.violationId,
          action: 'investigation_listed',
        });
      }

      // **The list is not filtered, only redacted.** That an inquiry exists is part of the case,
      // which this permission already reaches; hiding concluded ones would also hide the count, and
      // a reader would not be able to tell a case with no inquiry from one they may not read. What
      // the inquiry *found* is withheld — which is exactly the line D-5.2-18 drew.
      const withFindings = await mayReadFindings(dependencies);

      return success({
        items: found.items.map((investigation) => investigationView(investigation, withFindings)),
        total: found.total,
      });
    }),
});

/**
 * Where a case is, and every step that got it there.
 *
 * **The violation is read first, and not for its content.** A history for an identifier that names
 * nothing would otherwise answer with an empty history and a `reported` state — which is a real
 * answer about a case that does not exist, and it would tell a caller that guessing identifiers is
 * harmless. Reading the violation makes an unknown case answer `not_found`, exactly as every other
 * read here does.
 *
 * `currentState` is derived from the returned history and read from no column (D-5.2-16).
 */
export interface ReadCaseHistory extends Query {
  readonly queryName: 'relations.case-history';
  readonly violationId: string;
}

export const readCaseHistoryHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadCaseHistory, CaseHistoryView> => ({
  queryName: 'relations.case-history',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const violation = await dependencies.stores.violations.byId(transaction, query.violationId);

      if (violation === undefined) return notFound<CaseHistoryView>('violation');

      const history = await dependencies.stores.caseEvents.forViolation(
        transaction,
        query.violationId,
      );

      await recordAccessFor(dependencies, transaction, {
        violationId: query.violationId,
        action: 'case_history_read',
      });
      return success(caseHistoryView(query.violationId, history));
    }),
});
