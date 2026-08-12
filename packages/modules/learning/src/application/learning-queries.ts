import { success, type Query, type QueryHandler } from '@work/kernel';

import type {
  AssessmentView,
  CourseVersionView,
  CourseView,
  InstructorView,
  MandatoryRuleView,
  PathDetailView,
  PathView,
} from '../contracts/views.js';
import { notFound } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import {
  assessmentView,
  courseVersionView,
  courseView,
  instructorView,
  mandatoryRuleView,
  pathStepView,
  pathView,
} from './learning-views.js';
import { pageOf } from './learning-paging.js';
import type { Page } from './learning-ports.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Reading the catalogue, the queues and the records.
 *
 * **Every collection read is bounded.** There is no query here that returns everything: a tenant
 * with a hundred thousand employments is the case this is designed for.
 *
 * **The two derived answers are computed at read time against a stated day.** "Is this overdue" and
 * "is this certificate still valid" are functions of a date and today, and no column holds either.
 * The `asOf` a caller supplies is echoed in the result so a screen can say what day it answered for
 * rather than implying "now" and being wrong by one when the request crossed midnight.
 *
 * **A learner-record read is scoped before it is filtered.** A caller with no scope gets an empty
 * page rather than an unbounded one, and an employment identifier in the request never widens what
 * the caller may see.
 */

export interface SearchCourses extends Query {
  readonly queryName: 'learning.search-courses';
  readonly status?: string;
  readonly delivery?: string;
  readonly categoryId?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchCoursesHandler = (
  dependencies: LearningDependencies,
): QueryHandler<SearchCourses, Page<CourseView>> => ({
  queryName: 'learning.search-courses',
  permission: LearningPermissions.catalogueRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.courses.search(
        transaction,
        {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.delivery === undefined ? {} : { delivery: query.delivery }),
          ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
        },
        pageOf(query),
      );

      return success({ items: found.items.map(courseView), total: found.total });
    }),
});

export interface ReadCourse extends Query {
  readonly queryName: 'learning.read-course';
  readonly courseId: string;
}

export interface CourseDetail {
  readonly course: CourseView;
  readonly versions: readonly CourseVersionView[];
  readonly assessments: readonly AssessmentView[];
}

/** A course with every version it has had — AD-004's "historical versions remain available". */
export const readCourseHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ReadCourse, CourseDetail> => ({
  queryName: 'learning.read-course',
  permission: LearningPermissions.catalogueRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const course = await dependencies.stores.courses.byId(transaction, query.courseId);

      if (course === undefined) return notFound<CourseDetail>('learning_course');

      const versions = await dependencies.stores.versions.forCourse(transaction, course.courseId);
      const current = course.currentVersionId;
      const assessments =
        current === undefined
          ? []
          : await dependencies.stores.assessments.forVersion(transaction, current);

      return success({
        course: courseView(course),
        versions: versions.map(courseVersionView),
        assessments: assessments.map(assessmentView),
      });
    }),
});

export interface ListPaths extends Query {
  readonly queryName: 'learning.list-paths';
  readonly page?: number;
  readonly size?: number;
}

export const listPathsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ListPaths, Page<PathView>> => ({
  queryName: 'learning.list-paths',
  permission: LearningPermissions.pathRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.paths.all(transaction, pageOf(query));

      return success({ items: found.items.map(pathView), total: found.total });
    }),
});

export interface ReadPath extends Query {
  readonly queryName: 'learning.read-path';
  readonly pathId: string;
}

export const readPathHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ReadPath, PathDetailView> => ({
  queryName: 'learning.read-path',
  permission: LearningPermissions.pathRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, query.pathId);

      if (path === undefined) return notFound<PathDetailView>('learning_path');

      const steps = await dependencies.stores.paths.stepsFor(transaction, path.pathId);

      return success({
        ...pathView(path),
        steps: [...steps].sort((a, b) => a.sequence - b.sequence).map(pathStepView),
      });
    }),
});

export interface ListMandatoryRules extends Query {
  readonly queryName: 'learning.list-mandatory-rules';
  readonly activeOnly?: boolean;
  readonly page?: number;
  readonly size?: number;
}

export const listMandatoryRulesHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ListMandatoryRules, Page<MandatoryRuleView>> => ({
  queryName: 'learning.list-mandatory-rules',
  permission: LearningPermissions.mandatoryRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.rules.all(
        transaction,
        query.activeOnly ?? false,
        pageOf(query),
      );

      return success({ items: found.items.map(mandatoryRuleView), total: found.total });
    }),
});

export interface ListInstructors extends Query {
  readonly queryName: 'learning.list-instructors';
  readonly activeOnly?: boolean;
  readonly page?: number;
  readonly size?: number;
}

export const listInstructorsHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ListInstructors, Page<InstructorView>> => ({
  queryName: 'learning.list-instructors',
  permission: LearningPermissions.instructorRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.instructors.all(
        transaction,
        query.activeOnly ?? false,
        pageOf(query),
      );

      return success({ items: found.items.map(instructorView), total: found.total });
    }),
});
