import { bumped, expectVersion, heldOr, paged, type Tables } from './in-memory-tables.js';
import type {
  AssessmentResultStore,
  AssessmentStore,
  CourseCategoryStore,
  CourseStore,
  CourseVersionStore,
  PathStore,
} from './learning-ports.js';

/**
 * The catalogue half of the in-memory stores.
 *
 * Split from the learner half so each factory stays readable rather than becoming one wall — the
 * shape Performance's three in-memory files established.
 *
 * Two of these are **insert and read only**, matching their production counterparts exactly: a course
 * version and an assessment result are records of things that happened, and the cheapest guarantee
 * that nobody rewrote one is to have no method that could.
 */

/** `undefined` in a filter means "not filtered", never "match nothing". */
export const like = (value: string | undefined, expected: string | undefined): boolean =>
  expected === undefined || value === expected;

/** A bound the caller did not supply is no bound. An empty bound is still a bound. */
export const within = (value: string, bound: readonly string[] | undefined): boolean =>
  bound === undefined || bound.includes(value);

export const categoryStore = (tables: Tables): CourseCategoryStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.categories.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.categories.values()].find((held) => held.code === code)),
  all: () => Promise.resolve([...tables.categories.values()]),
  insert: (_transaction, state) => {
    tables.categories.set(state.categoryId, state);
    return Promise.resolve();
  },
});

export const courseStore = (tables: Tables): CourseStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.courses.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.courses.values()].find((held) => held.code === code)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.courses.values()].filter(
          (held) =>
            like(held.status, filters.status) &&
            like(held.delivery, filters.delivery) &&
            like(held.categoryId, filters.categoryId),
        ),
        page,
      ),
    ),
  insert: (_transaction, state) => {
    tables.courses.set(state.courseId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_course', tables.courses.get(state.courseId));

    expectVersion('learning_course', held, expected);
    tables.courses.set(state.courseId, bumped(state));
    return Promise.resolve();
  },
});

/** Insert and read. A version is what a completed enrolment points at (AD-004). */
export const versionStore = (tables: Tables): CourseVersionStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.versions.get(id)),
  forCourse: (_transaction, courseId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((held) => held.courseId === courseId)
        .sort((first, second) => second.versionNumber - first.versionNumber),
    ),
  highestVersionNumber: (_transaction, courseId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((held) => held.courseId === courseId)
        .reduce((highest, held) => Math.max(highest, held.versionNumber), 0),
    ),
  insert: (_transaction, state) => {
    tables.versions.set(state.courseVersionId, state);
    return Promise.resolve();
  },
});

export const assessmentStore = (tables: Tables): AssessmentStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.assessments.get(id)),
  forVersion: (_transaction, courseVersionId) =>
    Promise.resolve(
      [...tables.assessments.values()].filter((held) => held.courseVersionId === courseVersionId),
    ),
  insert: (_transaction, state) => {
    tables.assessments.set(state.assessmentId, state);
    return Promise.resolve();
  },
});

/** Insert and read. What an assessor recorded on a date is a thing that happened. */
export const resultStore = (tables: Tables): AssessmentResultStore => ({
  forEnrolment: (_transaction, enrolmentId) =>
    Promise.resolve(tables.results.filter((held) => held.enrolmentId === enrolmentId)),
  insert: (_transaction, state) => {
    tables.results.push(state);
    return Promise.resolve();
  },
});

export const pathStore = (tables: Tables): PathStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.paths.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.paths.values()].find((held) => held.code === code)),
  all: (_transaction, page) => Promise.resolve(paged([...tables.paths.values()], page)),
  stepsFor: (_transaction, pathId) =>
    Promise.resolve([...tables.pathSteps.values()].filter((held) => held.pathId === pathId)),
  insert: (_transaction, state) => {
    tables.paths.set(state.pathId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_path', tables.paths.get(state.pathId));

    expectVersion('learning_path', held, expected);
    tables.paths.set(state.pathId, bumped(state));
    return Promise.resolve();
  },
  insertStep: (_transaction, state) => {
    tables.pathSteps.set(state.stepId, state);
    return Promise.resolve();
  },
  removeStep: (_transaction, stepId) => {
    tables.pathSteps.delete(stepId);
    return Promise.resolve();
  },
});
