import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import type {
  CandidateSnapshot,
  CandidateView,
  RequisitionSnapshot,
  RequisitionView,
  VacancyView,
} from '../contracts/views.js';
import type { MatchedPerson } from './recruitment-ports.js';

import { notFound } from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import {
  applicationView,
  candidateView,
  profileEntryView,
  requisitionDecisionView,
  requisitionView,
  vacancyView,
} from './recruitment-views.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Reading requisitions, vacancies and candidates.
 *
 * **A candidate search never leaves the tenant**, and that is enforced below the query rather than
 * by it: row-level security answers every read, and the filters here narrow what the policy already
 * bounded. The name half of a free-text search is a sequential scan for a documented reason —
 * `ilike` is not leakproof, so the planner will not use a trigram index ahead of the security qual.
 * Measured rather than assumed, and not fixed by weakening isolation (A-9).
 *
 * **Matching against People is a suggestion, never an action.** The match query returns candidates
 * for a human decision and links nothing: two people share a family email address more often than a
 * product designer expects.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const boundsOf = (query: { readonly page?: number; readonly size?: number }) => {
  const page = Math.max(1, query.page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));

  return { page, size, limit: size, offset: (page - 1) * size };
};

export interface SearchRequisitions extends Query {
  readonly queryName: 'recruitment.search-requisitions';
  readonly term?: string;
  readonly status?: string;
  readonly positionId?: string;
  readonly unitId?: string;
  readonly hiringManagerEmploymentId?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchRequisitionsHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<SearchRequisitions, PagedResult<RequisitionView>> => ({
  queryName: 'recruitment.search-requisitions',
  permission: RecruitmentPermissions.requisitionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.requisitions.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.term === undefined ? {} : { term: query.term }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.positionId === undefined ? {} : { positionId: query.positionId }),
        ...(query.unitId === undefined ? {} : { unitId: query.unitId }),
        ...(query.hiringManagerEmploymentId === undefined
          ? {}
          : { hiringManagerEmploymentId: query.hiringManagerEmploymentId }),
      });

      return success(
        pagedResult(found.items.map(requisitionView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface ReadRequisition extends Query {
  readonly queryName: 'recruitment.read-requisition';
  readonly requisitionId: string;
}

/**
 * One requisition, its decisions and its vacancies.
 *
 * The decisions are published in full because "who authorized this headcount, and did anybody
 * reverse it" is the question a headcount audit asks, and an approval nobody can trace back to a
 * named human is not a control (ADR-0045).
 */
export const readRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadRequisition, RequisitionSnapshot> => ({
  queryName: 'recruitment.read-requisition',
  permission: RecruitmentPermissions.requisitionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.requisitions.byId(transaction, query.requisitionId);

      if (state === undefined) return notFound<RequisitionSnapshot>('requisition');

      const decisions = await dependencies.stores.decisions.forRequisition(
        transaction,
        query.requisitionId,
      );
      const vacancies = await dependencies.stores.vacancies.forRequisition(
        transaction,
        query.requisitionId,
      );

      return success({
        requisition: requisitionView(state),
        decisions: decisions.map(requisitionDecisionView),
        vacancies: vacancies.map(vacancyView),
      });
    }),
});

export interface SearchVacancies extends Query {
  readonly queryName: 'recruitment.search-vacancies';
  readonly status?: string;
  readonly requisitionId?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchVacanciesHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<SearchVacancies, PagedResult<VacancyView>> => ({
  queryName: 'recruitment.search-vacancies',
  permission: RecruitmentPermissions.vacancyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.vacancies.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.requisitionId === undefined ? {} : { requisitionId: query.requisitionId }),
      });

      return success(
        pagedResult(found.items.map(vacancyView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface SearchCandidates extends Query {
  readonly queryName: 'recruitment.search-candidates';
  readonly term?: string;
  readonly status?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly sourceCode?: string;
  readonly personId?: string;
  /** Candidates holding a profile entry with this code — a skill, a language, a qualification. */
  readonly profileCode?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchCandidatesHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<SearchCandidates, PagedResult<CandidateView>> => ({
  queryName: 'recruitment.search-candidates',
  permission: RecruitmentPermissions.candidateRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.candidates.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.term === undefined ? {} : { term: query.term }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.email === undefined ? {} : { email: query.email }),
        ...(query.phone === undefined ? {} : { phone: query.phone }),
        ...(query.sourceCode === undefined ? {} : { sourceCode: query.sourceCode }),
        ...(query.personId === undefined ? {} : { personId: query.personId }),
        ...(query.profileCode === undefined ? {} : { profileCode: query.profileCode }),
      });

      return success(
        pagedResult(found.items.map(candidateView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface ReadCandidate extends Query {
  readonly queryName: 'recruitment.read-candidate';
  readonly candidateId: string;
}

export const readCandidateHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadCandidate, CandidateSnapshot> => ({
  queryName: 'recruitment.read-candidate',
  permission: RecruitmentPermissions.candidateRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, query.candidateId);

      if (state === undefined) return notFound<CandidateSnapshot>('candidate');

      const profile = await dependencies.stores.profileEntries.forCandidate(
        transaction,
        query.candidateId,
      );
      const applications = await dependencies.stores.applications.forCandidate(
        transaction,
        query.candidateId,
      );

      return success({
        candidate: candidateView(state),
        profile: profile.filter((entry) => entry.withdrawnAt === undefined).map(profileEntryView),
        applications: applications.map(applicationView),
      });
    }),
});

export interface MatchCandidateToPeople extends Query {
  readonly queryName: 'recruitment.match-candidate';
  readonly candidateId: string;
}

export interface PersonMatchView {
  readonly candidateId: string;
  readonly matches: readonly MatchedPerson[];
}

/**
 * People who might already be this candidate.
 *
 * A **suggestion for a human**, and the reason ADR-0043 exists: the recruiter running it does not
 * hold `people.person.read`, and does not acquire it — the module holds the narrow permission for
 * the duration of this one operation, under a grant that is tenant-scoped and observable. Nothing is
 * linked by running it.
 */
export const matchCandidateHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<MatchCandidateToPeople, PersonMatchView> => ({
  queryName: 'recruitment.match-candidate',
  permission: RecruitmentPermissions.candidateManage,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, query.candidateId);

      if (state === undefined) return notFound<PersonMatchView>('candidate');

      const matches = await dependencies.people.findByContact(state.email, state.phone);

      return success({
        candidateId: query.candidateId,
        matches: matches.filter((match) => match.mergedIntoPersonId === undefined),
      });
    }),
});
