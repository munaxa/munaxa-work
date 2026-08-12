import {
  COURSE_TRANSITIONS,
  isCode,
  isWholeWithin,
  type CourseDelivery,
  type CourseStatus,
} from './learning-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type LearningResult,
  type LocalizedName,
} from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * A course: a stable identity, and the versions that say what it currently teaches.
 *
 * **The identity is stable and the content is versioned**, which is the `document` → `document_version`
 * pattern Phase 12 established and the reason AD-004 is satisfiable at all. A course keeps one
 * identifier for its whole life; changing what it teaches publishes a new version and leaves every
 * previous one readable. An enrolment references a **version**, so a completed enrolment still names
 * what was actually completed after somebody rewrites the syllabus (§12 of the instruction).
 *
 * **Archived, never deleted.** A course withdrawn from the catalogue stays readable, because a
 * certification issued three years ago has to remain explainable and a deleted course would make it
 * unexplainable. Archival is terminal: a course that came back would be a course with a gap in its
 * history.
 *
 * **`categoryId` is a tenant's own taxonomy** and no rule here reads it. `delivery` is likewise a
 * label — nothing in Phase 14A books a room, schedules a trainer or allocates a seat, and a course
 * marked `classroom` is one a tenant arranges outside this product until Phase 14B.
 */

export interface CourseState {
  readonly courseId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly categoryId?: string;
  readonly delivery: CourseDelivery;
  readonly status: CourseStatus;
  /** The version a new enrolment gets. Absent until something is published. */
  readonly currentVersionId?: string;
  readonly versionCount: number;
  readonly archivedAt?: Date;
  readonly archivedBy?: string;
  readonly version: number;
}

export interface CreateCourseRequest {
  readonly courseId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly categoryId?: string;
  readonly delivery: CourseDelivery;
}

export const createCourse = (request: CreateCourseRequest): LearningResult<CourseState> => {
  if (!isCode(request.code)) return refuse('course-code-invalid', { code: request.code });
  if (!isLocalizedName(request.name)) return refuse('course-name-required');
  if (request.description !== undefined && !isLocalizedName(request.description)) {
    return refuse('course-description-incomplete');
  }

  return accept({
    courseId: request.courseId,
    code: request.code,
    name: request.name,
    delivery: request.delivery,
    // A course starts in draft with nothing published. It cannot be enrolled into until a version
    // exists, which is what makes "published" mean something rather than being a label.
    status: 'draft',
    versionCount: 0,
    version: 1,
    ...definedOf({ description: request.description, categoryId: request.categoryId }),
  });
};

const permits = (from: CourseStatus, to: CourseStatus): boolean =>
  COURSE_TRANSITIONS[from].includes(to);

/**
 * Publishing a course means publishing a version of it.
 *
 * A course cannot reach `published` with nothing to teach: `currentVersionId` is what an enrolment
 * pins, and a published course without one would accept enrolments that reference nothing.
 */
export const publishCourse = (
  state: CourseState,
  versionId: string,
  versionCount: number,
): LearningResult<CourseState> => {
  if (state.status === 'archived') return refuse('course-archived', { courseId: state.courseId });

  return accept({
    ...state,
    status: 'published',
    currentVersionId: versionId,
    versionCount,
  });
};

export const archiveCourse = (
  state: CourseState,
  at: Date,
  by: string,
): LearningResult<CourseState> => {
  if (!permits(state.status, 'archived')) {
    return refuse('course-transition-refused', { from: state.status, to: 'archived' });
  }

  return accept({ ...state, status: 'archived', archivedAt: at, archivedBy: by });
};

/** Whether a course may be enrolled into at all. Read by the enrolment rule, never re-derived. */
export const isEnrollable = (state: CourseState): boolean =>
  state.status === 'published' && state.currentVersionId !== undefined;

/**
 * One version of a course: what it taught, for as long as anybody needs to know.
 *
 * **Insert-only.** There is no update on this shape and no path that produces one — AD-004 says
 * historical versions remain available, and a version that could be edited would make every
 * enrolment pinned to it a record of something that may since have changed. Correcting a course
 * publishes version 4; it does not rewrite version 3.
 *
 * `contentReference` is an **opaque key this module never resolves**. No storage adapter exists
 * anywhere in this repository, so there is no upload, no download and no URL — the same position
 * Documents takes about `storage_reference`, and for the same reason.
 *
 * `requiresAssessment` is **tenant configuration, not an invented rule**. The specification defines
 * no pass threshold and no scoring formula, so this product does not decide what passing means; it
 * records whether the tenant requires an assessment outcome before completion, and the tenant's
 * authorized assessor records the outcome.
 */
export interface CourseVersionState {
  readonly courseVersionId: string;
  readonly courseId: string;
  readonly versionNumber: number;
  readonly title: LocalizedName;
  readonly objectives?: LocalizedName;
  /** An opaque key. This module holds no bytes and resolves nothing. */
  readonly contentReference?: string;
  readonly durationMinutes?: number;
  /** Whether completion requires a passed assessment. Configuration, not a rule this product wrote. */
  readonly requiresAssessment: boolean;
  /** How long a certification issued from this version stays valid, in whole months. */
  readonly certificationValidMonths?: number;
  readonly publishedAt: Date;
  readonly publishedBy: string;
  readonly version: number;
}

export interface PublishVersionRequest {
  readonly courseVersionId: string;
  readonly courseId: string;
  readonly versionNumber: number;
  readonly title: LocalizedName;
  readonly objectives?: LocalizedName;
  readonly contentReference?: string;
  readonly durationMinutes?: number;
  readonly requiresAssessment: boolean;
  readonly certificationValidMonths?: number;
  readonly publishedAt: Date;
  readonly publishedBy: string;
}

const MAX_DURATION_MINUTES = 60 * 24 * 365;
const MAX_VALID_MONTHS = 600;

export const publishVersion = (
  request: PublishVersionRequest,
): LearningResult<CourseVersionState> => {
  if (!isLocalizedName(request.title)) return refuse('course-version-title-required');
  if (request.versionNumber < 1) return refuse('course-version-number-invalid');
  const duration = request.durationMinutes;
  const validMonths = request.certificationValidMonths;

  if (duration !== undefined && !isWholeWithin(duration, 1, MAX_DURATION_MINUTES)) {
    return refuse('course-duration-invalid');
  }
  if (validMonths !== undefined && !isWholeWithin(validMonths, 1, MAX_VALID_MONTHS)) {
    return refuse('certification-validity-invalid');
  }

  return accept({
    courseVersionId: request.courseVersionId,
    courseId: request.courseId,
    versionNumber: request.versionNumber,
    title: request.title,
    requiresAssessment: request.requiresAssessment,
    publishedAt: request.publishedAt,
    publishedBy: request.publishedBy,
    version: 1,
    ...definedOf({
      objectives: request.objectives,
      contentReference: request.contentReference,
      durationMinutes: request.durationMinutes,
      certificationValidMonths: request.certificationValidMonths,
    }),
  });
};
