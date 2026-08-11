import type { GoalState } from '../domain/goal.js';
import type {
  GoalFilters,
  PerformanceStores,
  AssessmentStore,
  ComponentScoreStore,
  CycleStore,
  GoalProgressStore,
  GoalStore,
  ReviewStore,
  ReviewerAssignmentStore,
} from './performance-ports.js';
import {
  ConstraintViolation,
  UNIQUE_VIOLATION,
  bumped,
  expectVersion,
  heldOr,
  paged,
  type Tables,
} from './in-memory-tables.js';

/**
 * Goals, progress, cycles, reviews, reviewer assignments, assessments and the scoring working.
 *
 * Two rules here are the ones the suites lean on hardest: the scope bound is applied *inside* the
 * search rather than to its result, exactly as the SQL predicate will be, and a submitted
 * assessment's items are frozen with it — the header's immutability would be decorative otherwise.
 */

/**
 * The goal predicate, and the one line in it that is a security rule rather than a filter.
 *
 * `employmentIdsIn` is the scope bound, applied *inside* the search exactly as the SQL predicate
 * will be. Filtering after the fact would mean the rows had already left the store, and a count of
 * what was then removed is itself a disclosure.
 */
const goalMatches =
  (filters: GoalFilters) =>
  (goal: GoalState): boolean =>
    matches(filters.employmentId, goal.employmentId) &&
    matches(filters.organizationUnitId, goal.organizationUnitId) &&
    matches(filters.cycleId, goal.cycleId) &&
    matches(filters.status, goal.status) &&
    matches(filters.scope, goal.scope) &&
    withinScope(filters.employmentIdsIn, goal.employmentId);

const matches = (filter: string | undefined, value: string | undefined): boolean =>
  filter === undefined || value === filter;

const withinScope = (
  bound: readonly string[] | undefined,
  employmentId: string | undefined,
): boolean => bound === undefined || (employmentId !== undefined && bound.includes(employmentId));

const goalsStore = (tables: Tables): GoalStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.goals.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(paged([...tables.goals.values()].filter(goalMatches(filters)), page)),
  forReview: (_transaction, employmentId, cycleId) =>
    Promise.resolve(
      [...tables.goals.values()].filter(
        (goal) => goal.employmentId === employmentId && goal.cycleId === cycleId,
      ),
    ),
  insert: (_transaction, state) => {
    tables.goals.set(state.goalId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('goals', tables.goals.get(state.goalId));

    expectVersion('goals', held, expected);
    tables.goals.set(state.goalId, bumped(state));
    return Promise.resolve();
  },
});

const goalProgressStore = (tables: Tables): GoalProgressStore => ({
  forGoal: (_transaction, goalId) =>
    Promise.resolve(tables.goalProgress.filter((entry) => entry.goalId === goalId)),
  insert: (_transaction, state) => {
    tables.goalProgress.push(state);
    return Promise.resolve();
  },
});

const cyclesStore = (tables: Tables): CycleStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.cycles.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.cycles.values()].find((cycle) => cycle.code === code)),
  all: (_transaction, page) => Promise.resolve(paged([...tables.cycles.values()], page)),
  insert: (_transaction, state) => {
    tables.cycles.set(state.cycleId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('cycles', tables.cycles.get(state.cycleId));

    expectVersion('cycles', held, expected);
    tables.cycles.set(state.cycleId, bumped(state));
    return Promise.resolve();
  },
});

const reviewsStore = (tables: Tables): ReviewStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.reviews.get(id)),
  forParticipant: (_transaction, cycleId, employmentId) =>
    Promise.resolve(
      [...tables.reviews.values()].find(
        (review) => review.cycleId === cycleId && review.employmentId === employmentId,
      ),
    ),
  forCycle: (_transaction, cycleId) =>
    Promise.resolve([...tables.reviews.values()].filter((review) => review.cycleId === cycleId)),
  search: (_transaction, filters, page) => {
    const matched = [...tables.reviews.values()].filter(
      (review) =>
        (filters.cycleId === undefined || review.cycleId === filters.cycleId) &&
        (filters.employmentId === undefined || review.employmentId === filters.employmentId) &&
        (filters.managerEmploymentId === undefined ||
          review.managerEmploymentId === filters.managerEmploymentId) &&
        (filters.status === undefined || review.status === filters.status) &&
        (filters.employmentIdsIn === undefined ||
          filters.employmentIdsIn.includes(review.employmentId)),
    );

    return Promise.resolve(paged(matched, page));
  },
  insert: (_transaction, state) => {
    // One review per employment per cycle, as the unique index will refuse it.
    const duplicate = [...tables.reviews.values()].some(
      (review) => review.cycleId === state.cycleId && review.employmentId === state.employmentId,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.reviews.set(state.reviewId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('reviews', tables.reviews.get(state.reviewId));

    expectVersion('reviews', held, expected);
    tables.reviews.set(state.reviewId, bumped(state));
    return Promise.resolve();
  },
});

const reviewersStore = (tables: Tables): ReviewerAssignmentStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.reviewers.get(id)),
  forReview: (_transaction, reviewId) =>
    Promise.resolve(
      [...tables.reviewers.values()].filter((assignment) => assignment.reviewId === reviewId),
    ),
  forReviewer: (_transaction, reviewerEmploymentId, page) =>
    Promise.resolve(
      paged(
        [...tables.reviewers.values()].filter(
          (assignment) => assignment.reviewerEmploymentId === reviewerEmploymentId,
        ),
        page,
      ),
    ),
  insert: (_transaction, state) => {
    const duplicate = [...tables.reviewers.values()].some(
      (assignment) =>
        assignment.reviewId === state.reviewId &&
        assignment.reviewerEmploymentId === state.reviewerEmploymentId &&
        assignment.role === state.role,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.reviewers.set(state.reviewerAssignmentId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('reviewers', tables.reviewers.get(state.reviewerAssignmentId));

    expectVersion('reviewers', held, expected);
    tables.reviewers.set(state.reviewerAssignmentId, bumped(state));
    return Promise.resolve();
  },
});

const assessmentsStore = (tables: Tables): AssessmentStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.assessments.get(id)),
  forReview: (_transaction, reviewId) =>
    Promise.resolve(
      [...tables.assessments.values()].filter((assessment) => assessment.reviewId === reviewId),
    ),
  forAssessor: (_transaction, reviewId, assessorEmploymentId, assessmentKind) =>
    Promise.resolve(
      [...tables.assessments.values()].find(
        (assessment) =>
          assessment.reviewId === reviewId &&
          assessment.assessorEmploymentId === assessorEmploymentId &&
          assessment.assessmentKind === assessmentKind,
      ),
    ),
  itemsFor: (_transaction, assessmentId) =>
    Promise.resolve(
      [...tables.assessmentItems.values()].filter((item) => item.assessmentId === assessmentId),
    ),
  insert: (_transaction, state) => {
    // One assessment per assessor per kind per review, as the unique index will refuse it.
    const duplicate = [...tables.assessments.values()].some(
      (assessment) =>
        assessment.reviewId === state.reviewId &&
        assessment.assessorEmploymentId === state.assessorEmploymentId &&
        assessment.assessmentKind === state.assessmentKind,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.assessments.set(state.assessmentId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('assessments', tables.assessments.get(state.assessmentId));

    expectVersion('assessments', held, expected);
    tables.assessments.set(state.assessmentId, bumped(state));
    return Promise.resolve();
  },
  upsertItem: (_transaction, item) => {
    const assessment = tables.assessments.get(item.assessmentId);

    // The trigger's rule, expressed where a developer meets it first: a submitted assessment's
    // lines are frozen with it, or the header's immutability would be decorative.
    if (assessment?.status === 'submitted') throw new ConstraintViolation('restrict_violation');
    tables.assessmentItems.set(item.assessmentItemId, item);
    return Promise.resolve();
  },
});

const componentScoresStore = (tables: Tables): ComponentScoreStore => ({
  forReview: (_transaction, reviewId) =>
    Promise.resolve(tables.componentScores.filter((record) => record.reviewId === reviewId)),
  replace: (_transaction, reviewId, records) => {
    const kept = tables.componentScores.filter((record) => record.reviewId !== reviewId);

    // Replaced, not appended: rescoring supersedes the previous working rather than accumulating
    // two answers to the same question.
    tables.componentScores.splice(0, tables.componentScores.length, ...kept, ...records);
    return Promise.resolve();
  },
});

export const reviewStores = (
  tables: Tables,
): Pick<
  PerformanceStores,
  'goals' | 'goalProgress' | 'cycles' | 'reviews' | 'reviewers' | 'assessments' | 'componentScores'
> => ({
  goals: goalsStore(tables),
  goalProgress: goalProgressStore(tables),
  cycles: cyclesStore(tables),
  reviews: reviewsStore(tables),
  reviewers: reviewersStore(tables),
  assessments: assessmentsStore(tables),
  componentScores: componentScoresStore(tables),
});
