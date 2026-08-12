import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import { like, within } from './in-memory-catalogue-stores.js';
import {
  assignmentConflicts,
  bumped,
  certificationConflicts,
  enrolmentConflicts,
  expectVersion,
  heldOr,
  paged,
  type Tables,
} from './in-memory-tables.js';
import type {
  AssignmentFilters,
  AssignmentStore,
  CertificationFilters,
  CertificationStore,
  EnrolmentFilters,
  EnrolmentStore,
  InstructorStore,
  MandatoryRuleStore,
} from './learning-ports.js';

/**
 * The learner half of the in-memory stores: requirements, queues, enrolments and certifications.
 *
 * **`insertIfAbsent` is where the idempotency guarantee lives** (ADR-0071). It answers "did I write
 * it" from the same conflict rule the partial unique index applies, so the suites test the mechanism
 * rather than a read-then-write check that happens to work when only one caller is running.
 */

export const ruleStore = (tables: Tables): MandatoryRuleStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.rules.get(id)),
  all: (_transaction, activeOnly, page) =>
    Promise.resolve(
      paged(
        [...tables.rules.values()].filter((held) => !activeOnly || held.active),
        page,
      ),
    ),
  insert: (_transaction, state) => {
    tables.rules.set(state.mandatoryRuleId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_mandatory_rule', tables.rules.get(state.mandatoryRuleId));

    expectVersion('learning_mandatory_rule', held, expected);
    tables.rules.set(state.mandatoryRuleId, bumped(state));
    return Promise.resolve();
  },
});

const dueBy = (dueOn: string | undefined, bound: string | undefined): boolean =>
  bound === undefined || (dueOn !== undefined && dueOn <= bound);

const matchingAssignments = (tables: Tables, filters: AssignmentFilters): AssignmentState[] =>
  [...tables.assignments.values()].filter(
    (held) =>
      like(held.employmentId, filters.employmentId) &&
      like(held.courseId, filters.courseId) &&
      like(held.status, filters.status) &&
      like(held.mandatoryRuleId, filters.mandatoryRuleId) &&
      dueBy(held.dueOn, filters.dueOnOrBefore) &&
      within(held.employmentId, filters.employmentIdsIn),
  );

export const assignmentStore = (tables: Tables): AssignmentStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.assignments.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(paged(matchingAssignments(tables, filters), page)),
  openFor: (_transaction, employmentId, courseId) =>
    Promise.resolve(
      [...tables.assignments.values()].find(
        (held) =>
          held.employmentId === employmentId &&
          held.courseId === courseId &&
          held.status === 'assigned',
      ),
    ),
  // `insert ... on conflict do nothing`: the index decides, not a prior read (ADR-0071).
  insertIfAbsent: (_transaction, state) => {
    if (assignmentConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.assignments.set(state.assignmentId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_assignment', tables.assignments.get(state.assignmentId));

    expectVersion('learning_assignment', held, expected);
    tables.assignments.set(state.assignmentId, bumped(state));
    return Promise.resolve();
  },
});

const matchingEnrolments = (tables: Tables, filters: EnrolmentFilters): EnrolmentState[] =>
  [...tables.enrolments.values()].filter(
    (held) =>
      like(held.employmentId, filters.employmentId) &&
      like(held.courseId, filters.courseId) &&
      like(held.status, filters.status) &&
      within(held.employmentId, filters.employmentIdsIn),
  );

/** The latest completion day of one course by one person. What the recurrence arithmetic reads. */
const lastCompletion = (
  tables: Tables,
  employmentId: string,
  courseId: string,
): string | undefined =>
  [...tables.enrolments.values()]
    .filter(
      (held) =>
        held.employmentId === employmentId &&
        held.courseId === courseId &&
        held.status === 'completed',
    )
    .map((held) => held.completedOn)
    .filter((on): on is string => on !== undefined)
    .sort()
    .at(-1);

export const enrolmentStore = (tables: Tables): EnrolmentStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.enrolments.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(paged(matchingEnrolments(tables, filters), page)),
  lastCompletionOf: (_transaction, employmentId, courseId) =>
    Promise.resolve(lastCompletion(tables, employmentId, courseId)),
  lastCompletionsOf: (_transaction, employmentIds, courseId) => {
    const found = new Map<string, string>();

    for (const employmentId of employmentIds) {
      const on = lastCompletion(tables, employmentId, courseId);

      if (on !== undefined) found.set(employmentId, on);
    }
    return Promise.resolve(found);
  },
  insertIfAbsent: (_transaction, state) => {
    if (enrolmentConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.enrolments.set(state.enrolmentId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_enrolment', tables.enrolments.get(state.enrolmentId));

    expectVersion('learning_enrolment', held, expected);
    tables.enrolments.set(state.enrolmentId, bumped(state));
    return Promise.resolve();
  },
});

/** The expiring queue's bound: active certifications lapsing on or before a stated civil date. */
const lapsingBy = (held: CertificationState, bound: string | undefined): boolean =>
  bound === undefined ||
  (held.status === 'active' && held.validUntil !== undefined && held.validUntil <= bound);

const matchingCertifications = (
  tables: Tables,
  filters: CertificationFilters,
): CertificationState[] =>
  [...tables.certifications.values()].filter(
    (held) =>
      like(held.employmentId, filters.employmentId) &&
      like(held.courseId, filters.courseId) &&
      like(held.status, filters.status) &&
      lapsingBy(held, filters.validUntilOnOrBefore) &&
      within(held.employmentId, filters.employmentIdsIn),
  );

export const certificationStore = (tables: Tables): CertificationStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.certifications.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(paged(matchingCertifications(tables, filters), page)),
  forEmployment: (_transaction, employmentId) =>
    Promise.resolve(
      [...tables.certifications.values()].filter((held) => held.employmentId === employmentId),
    ),
  forEnrolment: (_transaction, enrolmentId) =>
    Promise.resolve(
      [...tables.certifications.values()].find((held) => held.enrolmentId === enrolmentId),
    ),
  insertIfAbsent: (_transaction, state) => {
    if (certificationConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.certifications.set(state.certificationId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_certification', tables.certifications.get(state.certificationId));

    expectVersion('learning_certification', held, expected);
    tables.certifications.set(state.certificationId, bumped(state));
    return Promise.resolve();
  },
});

export const instructorStore = (tables: Tables): InstructorStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.instructors.get(id)),
  all: (_transaction, activeOnly, page) =>
    Promise.resolve(
      paged(
        [...tables.instructors.values()].filter((held) => !activeOnly || held.active),
        page,
      ),
    ),
  insert: (_transaction, state) => {
    tables.instructors.set(state.instructorId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('learning_instructor', tables.instructors.get(state.instructorId));

    expectVersion('learning_instructor', held, expected);
    tables.instructors.set(state.instructorId, bumped(state));
    return Promise.resolve();
  },
});
