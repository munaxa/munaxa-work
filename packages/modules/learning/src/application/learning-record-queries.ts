import { success, type Query, type QueryHandler } from '@work/kernel';

import type {
  AssessmentResultView,
  AssignmentView,
  CertificationView,
  EnrolmentView,
} from '../contracts/views.js';
import { civilDateOf, notFound } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import { boundOf, learnerScopeFor } from './authorization.js';
import {
  assessmentResultView,
  assignmentView,
  certificationView,
  enrolmentView,
} from './learning-views.js';
import { emptyPage, pageOf } from './learning-paging.js';
import type { Page } from './learning-ports.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Reading what happened to people: their queues, their courses, their results and their certificates.
 *
 * **Scoped before it is filtered.** A caller with no scope gets an empty page rather than an
 * unbounded one, and an employment identifier in the request is a filter — never a claim about who
 * is asking.
 *
 * **The two derived answers are computed here against a stated day**, and echoed back. "Is this
 * overdue" and "is this certificate still valid" are functions of a date and today; no column holds
 * either, so nothing has to move one overnight (ADR-0070, ADR-0071).
 */

export interface SearchAssignments extends Query {
  readonly queryName: 'learning.search-assignments';
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  /** Due on or before this civil date. How an overdue queue is asked for, without a stored flag. */
  readonly dueOnOrBefore?: string;
  readonly asOf?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface AssignmentPage extends Page<AssignmentView> {
  /** The day `overdue` was computed against, echoed so a screen can say what it answered for. */
  readonly asOf: string;
}

export const searchAssignmentsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<SearchAssignments, AssignmentPage> => ({
  queryName: 'learning.search-assignments',
  permission: LearningPermissions.assignmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const scope = await learnerScopeFor(dependencies);

      if (scope.kind === 'none') return success({ ...emptyPage<AssignmentView>(), asOf });

      const bound = boundOf(scope);
      const found = await dependencies.stores.assignments.search(
        transaction,
        {
          ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
          ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.dueOnOrBefore === undefined ? {} : { dueOnOrBefore: query.dueOnOrBefore }),
          ...(bound === undefined ? {} : { employmentIdsIn: bound }),
        },
        pageOf(query),
      );

      return success({
        items: found.items.map((state) => assignmentView(state, asOf)),
        total: found.total,
        asOf,
      });
    }),
});

export interface SearchEnrolments extends Query {
  readonly queryName: 'learning.search-enrolments';
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchEnrolmentsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<SearchEnrolments, Page<EnrolmentView>> => ({
  queryName: 'learning.search-enrolments',
  permission: LearningPermissions.enrolmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await learnerScopeFor(dependencies);

      if (scope.kind === 'none') return success(emptyPage<EnrolmentView>());

      const bound = boundOf(scope);
      const found = await dependencies.stores.enrolments.search(
        transaction,
        {
          ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
          ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(bound === undefined ? {} : { employmentIdsIn: bound }),
        },
        pageOf(query),
      );

      return success({ items: found.items.map(enrolmentView), total: found.total });
    }),
});

export interface ReadAssessmentResults extends Query {
  readonly queryName: 'learning.read-assessment-results';
  readonly enrolmentId: string;
}

/**
 * The outcomes recorded against one enrolment, exactly as the assessors recorded them.
 *
 * **Nothing is totalled here.** No average, no percentage, no pass/fail verdict over the set — the
 * specification defines no formula, and aggregate scoring is `NOT VERIFIED`.
 */
export const readAssessmentResultsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ReadAssessmentResults, readonly AssessmentResultView[]> => ({
  queryName: 'learning.read-assessment-results',
  permission: LearningPermissions.assessmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const enrolment = await dependencies.stores.enrolments.byId(transaction, query.enrolmentId);

      if (enrolment === undefined) {
        return notFound<readonly AssessmentResultView[]>('learning_enrolment');
      }

      const results = await dependencies.stores.results.forEnrolment(
        transaction,
        query.enrolmentId,
      );

      return success(results.map(assessmentResultView));
    }),
});

export interface SearchCertifications extends Query {
  readonly queryName: 'learning.search-certifications';
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  /** Active certifications lapsing on or before this civil date. The expiring queue. */
  readonly validUntilOnOrBefore?: string;
  readonly asOf?: string;
  /** How many days ahead counts as `expiring_soon`. `0` asks a plain yes-or-no question. */
  readonly noticeDays?: number;
  readonly page?: number;
  readonly size?: number;
}

export interface CertificationPage extends Page<CertificationView> {
  readonly asOf: string;
}

export const searchCertificationsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<SearchCertifications, CertificationPage> => ({
  queryName: 'learning.search-certifications',
  permission: LearningPermissions.certificationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const scope = await learnerScopeFor(dependencies);

      if (scope.kind === 'none') return success({ ...emptyPage<CertificationView>(), asOf });

      const bound = boundOf(scope);
      const found = await dependencies.stores.certifications.search(
        transaction,
        {
          ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
          ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.validUntilOnOrBefore === undefined
            ? {}
            : { validUntilOnOrBefore: query.validUntilOnOrBefore }),
          ...(bound === undefined ? {} : { employmentIdsIn: bound }),
        },
        pageOf(query),
      );

      return success({
        items: found.items.map((state) => certificationView(state, asOf, query.noticeDays ?? 0)),
        total: found.total,
        asOf,
      });
    }),
});
