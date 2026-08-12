import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { CourseState, CourseVersionState } from '../domain/course.js';
import type { PathState, PathStepState } from '../domain/path.js';
import type { LocalizedName } from '../domain/learning-rejection.js';
import type {
  AssessmentKind,
  AssessmentOutcome,
  CourseDelivery,
  CourseStatus,
  PathKind,
  PathStatus,
} from '../domain/learning-vocabulary.js';
import type { CourseCategoryState } from '../application/learning-ports.js';
import { asNumber, civilDateColumn, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Catalogue rows, and the mapping in both directions.
 *
 * **Civil dates never become `Date` on this path.** The domain already holds them as
 * `YYYY-MM-DD` strings, so a `to_char` alias on the way out and a plain string on the way in is the
 * whole conversion — there is no timezone anywhere in it, and therefore no day to lose.
 *
 * **`raw_mark` is copied verbatim.** It is `varchar` in the schema and `string` in the domain, and
 * nothing between them parses it. That is not fastidiousness: a mark a tenant typed as `9007199254740993`
 * is a number JavaScript cannot hold exactly, and a mapper that touched it would hand back a
 * different number from the one an assessor wrote down.
 */

export const localized = (value: unknown): LocalizedName => value as LocalizedName;

// ------------------------------------------------------------------------------------------------
// Categories
// ------------------------------------------------------------------------------------------------

export interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly version: number;
}

export const CATEGORY_COLUMNS = 'id, code, name, version';

export const categoryState = (row: CategoryRow): CourseCategoryState => ({
  categoryId: row.id,
  code: row.code,
  name: localized(row.name),
  version: asNumber(row.version),
});

export const categoryValues = (state: CourseCategoryState, tenantId: string): RowValues => ({
  id: state.categoryId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: null,
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Courses
// ------------------------------------------------------------------------------------------------

export interface CourseRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: unknown;
  readonly category_id: string | null;
  readonly delivery: string;
  readonly status: string;
  readonly current_version_id: string | null;
  readonly version_count: string;
  readonly archived_at: Date | null;
  readonly archived_by: string | null;
  readonly version: number;
}

/**
 * `version_count` is counted rather than stored.
 *
 * A stored counter would need updating from the one place that publishes a version, and the first
 * missed update would be a catalogue screen claiming a course has three versions when it has four.
 * The subquery is bounded by the course and indexed by `learning_course_version_course_idx`.
 */
export const courseColumns = (alias: string): string => `
  ${alias}.id, ${alias}.code, ${alias}.name, ${alias}.description, ${alias}.category_id,
  ${alias}.delivery, ${alias}.status, ${alias}.current_version_id, ${alias}.archived_at,
  ${alias}.archived_by, ${alias}.version,
  (select count(*)::text from learning_course_version v
     where v.tenant_id = ${alias}.tenant_id and v.course_id = ${alias}.id
       and v.deleted_at is null) as version_count`;

export const courseState = (row: CourseRow): CourseState => ({
  courseId: row.id,
  code: row.code,
  name: localized(row.name),
  delivery: row.delivery as CourseDelivery,
  status: row.status as CourseStatus,
  versionCount: asNumber(row.version_count),
  version: asNumber(row.version),
  ...presentOf({
    description: row.description === null ? null : localized(row.description),
    categoryId: row.category_id,
    currentVersionId: row.current_version_id,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  }),
});

export const courseValues = (state: CourseState, tenantId: string): RowValues => ({
  id: state.courseId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  category_id: orNull(state.categoryId),
  delivery: state.delivery,
  status: state.status,
  current_version_id: orNull(state.currentVersionId),
  archived_at: orNull(state.archivedAt),
  archived_by: orNull(state.archivedBy),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Course versions — insert-only (AD-004)
// ------------------------------------------------------------------------------------------------

export interface CourseVersionRow {
  readonly id: string;
  readonly course_id: string;
  readonly version_number: number;
  readonly title: unknown;
  readonly objectives: unknown;
  readonly content_reference: string | null;
  readonly duration_minutes: number | null;
  readonly requires_assessment: boolean;
  readonly certification_valid_months: number | null;
  readonly published_at: Date;
  readonly published_by: string;
  readonly version: number;
}

export const VERSION_COLUMNS = `id, course_id, version_number, title, objectives,
  content_reference, duration_minutes, requires_assessment, certification_valid_months,
  published_at, published_by, version`;

export const courseVersionState = (row: CourseVersionRow): CourseVersionState => ({
  courseVersionId: row.id,
  courseId: row.course_id,
  versionNumber: asNumber(row.version_number),
  title: localized(row.title),
  requiresAssessment: row.requires_assessment,
  publishedAt: row.published_at,
  publishedBy: row.published_by,
  version: asNumber(row.version),
  // `presentOf` drops nulls and nothing else, so a duration of zero would survive — the check
  // constraint refuses one, but the mapper does not decide that.
  ...presentOf({
    objectives: row.objectives === null ? null : localized(row.objectives),
    contentReference: row.content_reference,
    durationMinutes: row.duration_minutes === null ? null : asNumber(row.duration_minutes),
    certificationValidMonths:
      row.certification_valid_months === null ? null : asNumber(row.certification_valid_months),
  }),
});

export const courseVersionValues = (state: CourseVersionState, tenantId: string): RowValues => ({
  id: state.courseVersionId,
  tenant_id: tenantId,
  course_id: state.courseId,
  version_number: state.versionNumber,
  title: JSON.stringify(state.title),
  objectives: state.objectives === undefined ? null : JSON.stringify(state.objectives),
  content_reference: orNull(state.contentReference),
  duration_minutes: orNull(state.durationMinutes),
  requires_assessment: state.requiresAssessment,
  certification_valid_months: orNull(state.certificationValidMonths),
  published_at: state.publishedAt,
  published_by: state.publishedBy,
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Assessments and their results
// ------------------------------------------------------------------------------------------------

export interface AssessmentRow {
  readonly id: string;
  readonly course_version_id: string;
  readonly title: unknown;
  readonly kind: string;
  readonly required: boolean;
  readonly version: number;
}

export const ASSESSMENT_COLUMNS = 'id, course_version_id, title, kind, required, version';

export const assessmentState = (row: AssessmentRow): AssessmentDefinitionState => ({
  assessmentId: row.id,
  courseVersionId: row.course_version_id,
  title: localized(row.title),
  kind: row.kind as AssessmentKind,
  required: row.required,
  version: asNumber(row.version),
});

export const assessmentValues = (
  state: AssessmentDefinitionState,
  tenantId: string,
): RowValues => ({
  id: state.assessmentId,
  tenant_id: tenantId,
  course_version_id: state.courseVersionId,
  title: JSON.stringify(state.title),
  kind: state.kind,
  required: state.required,
  metadata: '{}',
});

export interface ResultRow {
  readonly id: string;
  readonly assessment_id: string;
  readonly enrolment_id: string;
  readonly employment_id: string;
  readonly outcome: string;
  readonly raw_mark: string | null;
  readonly raw_mark_scale: string | null;
  readonly assessed_on: string;
  readonly assessed_by: string;
  readonly notes: string | null;
  readonly recorded_at: Date;
}

export const RESULT_COLUMNS = `id, assessment_id, enrolment_id, employment_id, outcome,
  raw_mark, raw_mark_scale, ${civilDateColumn('assessed_on', 'assessed_on')},
  assessed_by, notes, recorded_at`;

/** The mark leaves as the string it arrived as. Nothing here parses it, so nothing rounds it. */
export const resultState = (row: ResultRow): AssessmentResultState => ({
  resultId: row.id,
  assessmentId: row.assessment_id,
  enrolmentId: row.enrolment_id,
  employmentId: row.employment_id,
  outcome: row.outcome as AssessmentOutcome,
  assessedOn: row.assessed_on,
  assessedBy: row.assessed_by,
  recordedAt: row.recorded_at,
  ...presentOf({
    rawMark: row.raw_mark,
    rawMarkScale: row.raw_mark_scale,
    notes: row.notes,
  }),
});

export const resultValues = (state: AssessmentResultState, tenantId: string): RowValues => ({
  id: state.resultId,
  tenant_id: tenantId,
  assessment_id: state.assessmentId,
  enrolment_id: state.enrolmentId,
  employment_id: state.employmentId,
  outcome: state.outcome,
  raw_mark: orNull(state.rawMark),
  raw_mark_scale: orNull(state.rawMarkScale),
  assessed_on: state.assessedOn,
  assessed_by: state.assessedBy,
  notes: orNull(state.notes),
  recorded_at: state.recordedAt,
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------------

export interface PathRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: unknown;
  readonly kind: string;
  readonly status: string;
  readonly step_count: string;
  readonly archived_at: Date | null;
  readonly archived_by: string | null;
  readonly version: number;
}

export const pathColumns = (alias: string): string => `
  ${alias}.id, ${alias}.code, ${alias}.name, ${alias}.description, ${alias}.kind, ${alias}.status,
  ${alias}.archived_at, ${alias}.archived_by, ${alias}.version,
  (select count(*)::text from learning_path_step s
     where s.tenant_id = ${alias}.tenant_id and s.path_id = ${alias}.id
       and s.deleted_at is null) as step_count`;

export const pathState = (row: PathRow): PathState => ({
  pathId: row.id,
  code: row.code,
  name: localized(row.name),
  kind: row.kind as PathKind,
  status: row.status as PathStatus,
  stepCount: asNumber(row.step_count),
  version: asNumber(row.version),
  ...presentOf({
    description: row.description === null ? null : localized(row.description),
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  }),
});

export const pathValues = (state: PathState, tenantId: string): RowValues => ({
  id: state.pathId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  kind: state.kind,
  status: state.status,
  archived_at: orNull(state.archivedAt),
  archived_by: orNull(state.archivedBy),
  metadata: '{}',
});

export interface PathStepRow {
  readonly id: string;
  readonly path_id: string;
  readonly course_id: string;
  readonly sequence: number;
  readonly optional: boolean;
  readonly version: number;
}

export const STEP_COLUMNS = 'id, path_id, course_id, sequence, optional, version';

export const pathStepState = (row: PathStepRow): PathStepState => ({
  stepId: row.id,
  pathId: row.path_id,
  courseId: row.course_id,
  sequence: asNumber(row.sequence),
  optional: row.optional,
  version: asNumber(row.version),
});

export const pathStepValues = (state: PathStepState, tenantId: string): RowValues => ({
  id: state.stepId,
  tenant_id: tenantId,
  path_id: state.pathId,
  course_id: state.courseId,
  sequence: state.sequence,
  optional: state.optional,
  metadata: '{}',
});
