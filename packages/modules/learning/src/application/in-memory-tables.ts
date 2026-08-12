import { ConcurrencyException } from '@work/kernel';

import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { CourseState, CourseVersionState } from '../domain/course.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import type { InstructorState } from '../domain/instructor.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type { PathState, PathStepState } from '../domain/path.js';
import type { CourseCategoryState, Page, Paged } from './learning-ports.js';

/**
 * The tables the in-memory stores share, and the production rules they all keep.
 *
 * **The optimistic version is checked on every update**, exactly as a real
 * `update ... where version = $expected` affects zero rows on a mismatch. That is what makes the
 * completion race testable before any database exists, and why these fakes raise the same exception
 * a repository would rather than quietly succeeding.
 *
 * **A fake more permissive than the database hides the defects these suites exist to find**, so the
 * unique indexes the schema carries are enforced here too: one course per code, one open enrolment
 * per person per course, one open assignment per person per course, one assignment per rule
 * occurrence, one certification per enrolment. The third and fourth are ADR-0071's idempotency
 * guarantee, and a fake that let a second reconciliation run write a second row would make the whole
 * suite meaningless.
 */

export const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

/**
 * The optimistic check, raising exactly what `Repository.updateRow` raises.
 *
 * `ConcurrencyException` rather than a quiet failure, because that is what the real repository
 * throws when its `where version = $expected` matches no row — and every module since Phase 2 lets
 * it travel to the edge, where it becomes a 409. A fake that returned a quiet failure instead would
 * let a losing writer look like a successful one.
 */
export const expectVersion = (
  table: string,
  held: { readonly version: number },
  expected: number,
): void => {
  if (held.version !== expected) throw new ConcurrencyException(table, expected, held.version);
};

export const bumped = <TState extends { readonly version: number }>(state: TState): TState => ({
  ...state,
  version: state.version + 1,
});

/** Reads the row an update targets, refusing the same way a vanished row would. */
export const heldOr = <TState>(table: string, candidate: TState | undefined): TState => {
  if (candidate === undefined) throw new ConcurrencyException(table, -1, -1);
  return candidate;
};

export interface Tables {
  readonly categories: Map<string, CourseCategoryState>;
  readonly courses: Map<string, CourseState>;
  readonly versions: Map<string, CourseVersionState>;
  readonly assessments: Map<string, AssessmentDefinitionState>;
  readonly results: AssessmentResultState[];
  readonly paths: Map<string, PathState>;
  readonly pathSteps: Map<string, PathStepState>;
  readonly rules: Map<string, MandatoryRuleState>;
  readonly assignments: Map<string, AssignmentState>;
  readonly enrolments: Map<string, EnrolmentState>;
  readonly certifications: Map<string, CertificationState>;
  readonly instructors: Map<string, InstructorState>;
}

export const emptyTables = (): Tables => ({
  categories: new Map(),
  courses: new Map(),
  versions: new Map(),
  assessments: new Map(),
  results: [],
  paths: new Map(),
  pathSteps: new Map(),
  rules: new Map(),
  assignments: new Map(),
  enrolments: new Map(),
  certifications: new Map(),
  instructors: new Map(),
});

/**
 * The partial unique index that carries ADR-0071's idempotency guarantee, as the fake sees it.
 *
 * A row conflicts when another undeleted assignment already covers the same rule occurrence for the
 * same employment, **or** when the same person already has an open assignment for the same course.
 * Both are indexes in the schema; both are what makes a repeated command converge instead of
 * duplicating.
 */
export const assignmentConflicts = (
  tables: Tables,
  candidate: AssignmentState,
): AssignmentState | undefined =>
  [...tables.assignments.values()].find(
    (held) =>
      held.employmentId === candidate.employmentId &&
      ((candidate.occurrenceKey !== undefined &&
        held.mandatoryRuleId === candidate.mandatoryRuleId &&
        held.occurrenceKey === candidate.occurrenceKey) ||
        (held.courseId === candidate.courseId && held.status === 'assigned')),
  );

/** One open enrolment per person per course. A retake after an ending is a new row, not a conflict. */
export const enrolmentConflicts = (
  tables: Tables,
  candidate: EnrolmentState,
): EnrolmentState | undefined =>
  [...tables.enrolments.values()].find(
    (held) =>
      held.employmentId === candidate.employmentId &&
      held.courseId === candidate.courseId &&
      (held.status === 'enrolled' || held.status === 'in_progress'),
  );

/** One certification per enrolment. An external one has no natural key and never conflicts. */
export const certificationConflicts = (
  tables: Tables,
  candidate: CertificationState,
): CertificationState | undefined =>
  candidate.enrolmentId === undefined
    ? undefined
    : [...tables.certifications.values()].find(
        (held) => held.enrolmentId === candidate.enrolmentId,
      );
