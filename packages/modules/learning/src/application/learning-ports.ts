import type { Transaction } from '@work/kernel';

import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { CourseState, CourseVersionState } from '../domain/course.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import type { InstructorState } from '../domain/instructor.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type { PathState, PathStepState } from '../domain/path.js';
import type { LocalizedName } from '../domain/learning-rejection.js';

/**
 * The persistence this module needs, as interfaces the domain never sees.
 *
 * Three stores are **deliberately narrower than the rest**. `CourseVersionStore` and
 * `AssessmentResultStore` offer inserts and reads and **no update, no remove**: each is a record of
 * something that already happened — what a course taught, what an assessor saw — and the cheapest
 * guarantee that nobody rewrote one is to have no method that could. The database refuses it too,
 * with a trigger; this is the same rule expressed where a developer meets it first.
 *
 * **`insertIfAbsent` is not a convenience.** It is the shape that makes reconciliation idempotent
 * under concurrency (ADR-0071): it maps to `insert ... on conflict do nothing` and returns whether
 * a row was written, so the *database index* decides and not a read-then-write check that two
 * administrators pressing the button at the same moment would both pass. A store that read first
 * and inserted second would be idempotent only in a test.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound. There is no unbounded query in this module: a tenant reconciling annual safety training
 * for a hundred thousand employments is the case this is designed for, not the exception.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface Clock {
  now(): Date;
}

// ------------------------------------------------------------------------------------------------
// Catalogue
// ------------------------------------------------------------------------------------------------

export interface CourseCategoryState {
  readonly categoryId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly version: number;
}

export interface CourseCategoryStore {
  byId(transaction: Transaction, id: string): Promise<CourseCategoryState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CourseCategoryState | undefined>;
  all(transaction: Transaction): Promise<readonly CourseCategoryState[]>;
  insert(transaction: Transaction, state: CourseCategoryState): Promise<void>;
}

export interface CourseFilters {
  readonly status?: string;
  readonly delivery?: string;
  readonly categoryId?: string;
}

export interface CourseStore {
  byId(transaction: Transaction, id: string): Promise<CourseState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CourseState | undefined>;
  search(
    transaction: Transaction,
    filters: CourseFilters,
    paged: Paged,
  ): Promise<Page<CourseState>>;
  insert(transaction: Transaction, state: CourseState): Promise<void>;
  /**
   * Optimistic. `expected` is the version the caller read; a mismatch is the refusal that settles
   * two administrators publishing the same course at the same moment.
   */
  update(transaction: Transaction, state: CourseState, expected: number): Promise<void>;
}

/** Insert and read. A version is what a completed enrolment points at; a rewritable one is not. */
export interface CourseVersionStore {
  byId(transaction: Transaction, id: string): Promise<CourseVersionState | undefined>;
  forCourse(transaction: Transaction, courseId: string): Promise<readonly CourseVersionState[]>;
  highestVersionNumber(transaction: Transaction, courseId: string): Promise<number>;
  insert(transaction: Transaction, state: CourseVersionState): Promise<void>;
}

export interface AssessmentStore {
  byId(transaction: Transaction, id: string): Promise<AssessmentDefinitionState | undefined>;
  forVersion(
    transaction: Transaction,
    courseVersionId: string,
  ): Promise<readonly AssessmentDefinitionState[]>;
  insert(transaction: Transaction, state: AssessmentDefinitionState): Promise<void>;
}

/** Insert and read. What an assessor recorded on a date is a thing that happened. */
export interface AssessmentResultStore {
  forEnrolment(
    transaction: Transaction,
    enrolmentId: string,
  ): Promise<readonly AssessmentResultState[]>;
  insert(transaction: Transaction, state: AssessmentResultState): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------------

export interface PathStore {
  byId(transaction: Transaction, id: string): Promise<PathState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<PathState | undefined>;
  all(transaction: Transaction, paged: Paged): Promise<Page<PathState>>;
  stepsFor(transaction: Transaction, pathId: string): Promise<readonly PathStepState[]>;
  insert(transaction: Transaction, state: PathState): Promise<void>;
  update(transaction: Transaction, state: PathState, expected: number): Promise<void>;
  insertStep(transaction: Transaction, state: PathStepState): Promise<void>;
  removeStep(transaction: Transaction, stepId: string, at: Date, by: string): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Mandatory rules and assignments
// ------------------------------------------------------------------------------------------------

export interface MandatoryRuleStore {
  byId(transaction: Transaction, id: string): Promise<MandatoryRuleState | undefined>;
  all(
    transaction: Transaction,
    activeOnly: boolean,
    paged: Paged,
  ): Promise<Page<MandatoryRuleState>>;
  insert(transaction: Transaction, state: MandatoryRuleState): Promise<void>;
  update(transaction: Transaction, state: MandatoryRuleState, expected: number): Promise<void>;
}

export interface AssignmentFilters {
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  readonly mandatoryRuleId?: string;
  /** Due on or before this civil date. How the compliance queue is bounded, and how overdue reads. */
  readonly dueOnOrBefore?: string;
  /** Restricts to these employments. How a team scope is bounded, never a client-supplied list. */
  readonly employmentIdsIn?: readonly string[];
}

export interface AssignmentStore {
  byId(transaction: Transaction, id: string): Promise<AssignmentState | undefined>;
  search(
    transaction: Transaction,
    filters: AssignmentFilters,
    paged: Paged,
  ): Promise<Page<AssignmentState>>;
  /** The open assignment for this employment and course, where there is one. */
  openFor(
    transaction: Transaction,
    employmentId: string,
    courseId: string,
  ): Promise<AssignmentState | undefined>;
  /**
   * Writes the row unless the database already holds one that conflicts, and says which happened.
   *
   * `insert ... on conflict do nothing`. **This is ADR-0071's idempotency guarantee**, and it is
   * why a second reconciliation run creates nothing even when it runs at the same instant as the
   * first. A `select` then an `insert` would not survive that, and would be idempotent only when
   * nobody was watching.
   */
  insertIfAbsent(transaction: Transaction, state: AssignmentState): Promise<boolean>;
  update(transaction: Transaction, state: AssignmentState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Enrolment, certification and instructors
// ------------------------------------------------------------------------------------------------

export interface EnrolmentFilters {
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  readonly employmentIdsIn?: readonly string[];
}

export interface EnrolmentStore {
  byId(transaction: Transaction, id: string): Promise<EnrolmentState | undefined>;
  search(
    transaction: Transaction,
    filters: EnrolmentFilters,
    paged: Paged,
  ): Promise<Page<EnrolmentState>>;
  /** The most recent completion of one course by one employment. What recurrence reads. */
  lastCompletionOf(
    transaction: Transaction,
    employmentId: string,
    courseId: string,
  ): Promise<string | undefined>;
  /** The most recent completion of one course by each of these employments, in one read. */
  lastCompletionsOf(
    transaction: Transaction,
    employmentIds: readonly string[],
    courseId: string,
  ): Promise<ReadonlyMap<string, string>>;
  /** Refused by a partial unique index where an open enrolment already exists. */
  insertIfAbsent(transaction: Transaction, state: EnrolmentState): Promise<boolean>;
  update(transaction: Transaction, state: EnrolmentState, expected: number): Promise<void>;
}

export interface CertificationFilters {
  readonly employmentId?: string;
  readonly courseId?: string;
  readonly status?: string;
  /** Active certifications lapsing on or before this civil date. The expiring queue's bound. */
  readonly validUntilOnOrBefore?: string;
  readonly employmentIdsIn?: readonly string[];
}

export interface CertificationStore {
  byId(transaction: Transaction, id: string): Promise<CertificationState | undefined>;
  search(
    transaction: Transaction,
    filters: CertificationFilters,
    paged: Paged,
  ): Promise<Page<CertificationState>>;
  forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly CertificationState[]>;
  /** The certification issued from this enrolment, where one was. */
  forEnrolment(
    transaction: Transaction,
    enrolmentId: string,
  ): Promise<CertificationState | undefined>;
  /** Idempotent for a completion-sourced certification: one per enrolment, decided by the index. */
  insertIfAbsent(transaction: Transaction, state: CertificationState): Promise<boolean>;
  update(transaction: Transaction, state: CertificationState, expected: number): Promise<void>;
}

export interface InstructorStore {
  byId(transaction: Transaction, id: string): Promise<InstructorState | undefined>;
  all(transaction: Transaction, activeOnly: boolean, paged: Paged): Promise<Page<InstructorState>>;
  insert(transaction: Transaction, state: InstructorState): Promise<void>;
  update(transaction: Transaction, state: InstructorState, expected: number): Promise<void>;
}

export interface LearningStores {
  readonly categories: CourseCategoryStore;
  readonly courses: CourseStore;
  readonly versions: CourseVersionStore;
  readonly assessments: AssessmentStore;
  readonly results: AssessmentResultStore;
  readonly paths: PathStore;
  readonly rules: MandatoryRuleStore;
  readonly assignments: AssignmentStore;
  readonly enrolments: EnrolmentStore;
  readonly certifications: CertificationStore;
  readonly instructors: InstructorStore;
}

export { documentsUnavailable } from './learning-cross-module-ports.js';
export type {
  Audience,
  DocumentReferencePort,
  EmploymentFacts,
  EmploymentPort,
  NotificationIntentPort,
  OrganizationPort,
} from './learning-cross-module-ports.js';
