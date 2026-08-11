import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import type {
  ApplicationSnapshot,
  ApplicationView,
  FeedbackView,
  InterviewView,
  PipelineView,
} from '../contracts/views.js';

import { notFound } from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import {
  applicationEventView,
  applicationView,
  byOccurredAtDescending,
  feedbackView,
  interviewView,
  offerView,
} from './recruitment-views.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Reading the pipeline: applications, their history, their interviews and their offers.
 *
 * **The board counts rather than loads.** A vacancy with forty thousand applications has a pipeline
 * summary that is an aggregate query, not forty thousand rows the API filters — the N+1 and the
 * unbounded read are the two failures a recruitment product reaches first.
 *
 * **Offers are read behind their own permission** because they carry proposed pay, and **feedback
 * behind another** because it carries an interviewer's candid opinion of somebody who does not work
 * here. Neither is granted by being able to read the application.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface SearchApplications extends Query {
  readonly queryName: 'recruitment.search-applications';
  readonly term?: string;
  readonly status?: string;
  readonly vacancyId?: string;
  readonly candidateId?: string;
  readonly stageCode?: string;
  /** Applications whose hire started and did not finish — the reconciliation query (ADR-0046). */
  readonly unfinishedHire?: boolean;
  readonly page?: number;
  readonly size?: number;
}

export const searchApplicationsHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<SearchApplications, PagedResult<ApplicationView>> => ({
  queryName: 'recruitment.search-applications',
  permission: RecruitmentPermissions.applicationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const found = await dependencies.stores.applications.search(transaction, {
        limit: size,
        offset: (page - 1) * size,
        ...(query.term === undefined ? {} : { term: query.term }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.vacancyId === undefined ? {} : { vacancyId: query.vacancyId }),
        ...(query.candidateId === undefined ? {} : { candidateId: query.candidateId }),
        ...(query.stageCode === undefined ? {} : { stageCode: query.stageCode }),
        ...(query.unfinishedHire === undefined ? {} : { unfinishedHire: query.unfinishedHire }),
      });

      return success(pagedResult(found.items.map(applicationView), page, size, found.total));
    }),
});

export interface ReadApplication extends Query {
  readonly queryName: 'recruitment.read-application';
  readonly applicationId: string;
}

/**
 * One application, whole: its history, its interviews and its offers.
 *
 * Returned together because they are read together — how a candidate reached where they are is one
 * question, and answering it in four round trips is four chances for a screen to show an interview
 * from one state beside a status from another.
 */
export const readApplicationHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadApplication, ApplicationSnapshot> => ({
  queryName: 'recruitment.read-application',
  permission: RecruitmentPermissions.applicationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.applications.byId(transaction, query.applicationId);

      if (state === undefined) return notFound<ApplicationSnapshot>('application');

      const history = await dependencies.stores.applicationEvents.forApplication(
        transaction,
        query.applicationId,
      );
      const interviews = await dependencies.stores.interviews.forApplication(
        transaction,
        query.applicationId,
      );
      const offers = await dependencies.stores.offers.forApplication(
        transaction,
        query.applicationId,
      );

      return success({
        application: applicationView(state),
        history: [...history].sort(byOccurredAtDescending).map(applicationEventView),
        interviews: interviews.map(interviewView),
        offers: offers.map(offerView),
      });
    }),
});

export interface ReadPipeline extends Query {
  readonly queryName: 'recruitment.read-pipeline';
  readonly vacancyId: string;
}

export const readPipelineHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadPipeline, PipelineView> => ({
  queryName: 'recruitment.read-pipeline',
  permission: RecruitmentPermissions.applicationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const vacancy = await dependencies.stores.vacancies.byId(transaction, query.vacancyId);

      if (vacancy === undefined) return notFound<PipelineView>('vacancy');

      const countsByStatus = await dependencies.stores.applications.countByStatus(
        transaction,
        query.vacancyId,
      );

      return success({
        vacancyId: query.vacancyId,
        countsByStatus,
        total: Object.values(countsByStatus).reduce((sum, count) => sum + count, 0),
      });
    }),
});

export interface ReadInterviews extends Query {
  readonly queryName: 'recruitment.read-interviews';
  readonly applicationId: string;
}

export const readInterviewsHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadInterviews, readonly InterviewView[]> => ({
  queryName: 'recruitment.read-interviews',
  permission: RecruitmentPermissions.interviewRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const interviews = await dependencies.stores.interviews.forApplication(
        transaction,
        query.applicationId,
      );

      return success(interviews.map(interviewView));
    }),
});

export interface ReadFeedback extends Query {
  readonly queryName: 'recruitment.read-feedback';
  readonly interviewId: string;
}

/**
 * What the panel said.
 *
 * Behind `recruitment.interview.feedback.read`, and **not aggregated**: no average, no computed
 * verdict. Whether three fours beat one five is a hiring policy this module has no business
 * inventing.
 */
export const readFeedbackHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ReadFeedback, readonly FeedbackView[]> => ({
  queryName: 'recruitment.read-feedback',
  permission: RecruitmentPermissions.feedbackRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const interview = await dependencies.stores.interviews.byId(transaction, query.interviewId);

      if (interview === undefined) return notFound<readonly FeedbackView[]>('interview');

      const feedback = await dependencies.stores.feedback.forInterview(
        transaction,
        query.interviewId,
      );

      return success(feedback.map(feedbackView));
    }),
});
