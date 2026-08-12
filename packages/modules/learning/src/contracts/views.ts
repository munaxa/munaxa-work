/**
 * What Learning publishes, as shapes another module or the API may depend on.
 *
 * **Dates leave as civil-date strings** (`YYYY-MM-DD`), never as `Date`. A due date, an issue date
 * and an expiry are the same day in every time zone, and a `Date` on the wire serializes
 * differently depending on who does it — the Phase 8 defect this product has already paid for once.
 *
 * **Derived state travels as a value, not as a stored column.** `validity` on a certification and
 * `overdue` on an assignment are computed against a stated `asOf` day, because the underlying tables
 * hold no such column and nothing in this product moves one overnight (ADR-0070, ADR-0071).
 *
 * **No aggregate score appears anywhere.** An assessment result carries the outcome an assessor
 * recorded and, where the tenant kept one, their own raw mark as the exact string they typed.
 * Nothing here totals, weights, thresholds or ranks them: the specification defines no formula, and
 * a computed number would be believed precisely because it looked computed.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

export interface CourseCategoryView {
  readonly categoryId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
}

export interface CourseView {
  readonly courseId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly description?: LocalizedTextView;
  readonly categoryId?: string;
  readonly delivery: string;
  readonly status: string;
  readonly currentVersionId?: string;
  readonly versionCount: number;
  readonly version: number;
}

export interface CourseVersionView {
  readonly courseVersionId: string;
  readonly courseId: string;
  readonly versionNumber: number;
  readonly title: LocalizedTextView;
  readonly objectives?: LocalizedTextView;
  readonly durationMinutes?: number;
  readonly requiresAssessment: boolean;
  readonly certificationValidMonths?: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface AssessmentView {
  readonly assessmentId: string;
  readonly courseVersionId: string;
  readonly title: LocalizedTextView;
  readonly kind: string;
  readonly required: boolean;
}

/** One assessor's record. **No score is derived from it anywhere in this product.** */
export interface AssessmentResultView {
  readonly resultId: string;
  readonly assessmentId: string;
  readonly enrolmentId: string;
  readonly outcome: string;
  /** The tenant's own text, exactly as typed. Never parsed, compared, ordered or totalled. */
  readonly rawMark?: string;
  readonly rawMarkScale?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
}

export interface PathStepView {
  readonly stepId: string;
  readonly courseId: string;
  readonly sequence: number;
  readonly optional: boolean;
}

export interface PathView {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly kind: string;
  readonly status: string;
  readonly stepCount: number;
  readonly version: number;
}

export interface PathDetailView extends PathView {
  readonly steps: readonly PathStepView[];
}

export interface MandatoryRuleView {
  readonly mandatoryRuleId: string;
  readonly courseId: string;
  readonly name: LocalizedTextView;
  readonly kind: string;
  readonly audience: string;
  readonly organizationUnitId?: string;
  readonly positionId?: string;
  readonly effectiveFrom: string;
  /** Whole months. `0` never repeats: once satisfied, always satisfied. */
  readonly recurrenceMonths: number;
  readonly dueWithinDays: number;
  readonly active: boolean;
  readonly version: number;
}

export interface AssignmentView {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  readonly source: string;
  readonly mandatoryRuleId?: string;
  readonly pathId?: string;
  /** The civil date the occurrence opened. Derived, not a counter (ADR-0071). */
  readonly occurrenceKey?: string;
  readonly status: string;
  readonly dueOn?: string;
  /** Derived against `asOf`. There is no `overdue` column, and there is nothing to move one. */
  readonly overdue: boolean;
  readonly assignedBy: string;
  readonly version: number;
}

export interface EnrolmentView {
  readonly enrolmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  /** Pinned at enrolment. Why a completion still names what was completed. */
  readonly courseVersionId: string;
  readonly assignmentId?: string;
  readonly status: string;
  readonly completedOn?: string;
  readonly completedBy?: string;
  readonly version: number;
}

export interface CertificationView {
  readonly certificationId: string;
  readonly employmentId: string;
  readonly enrolmentId?: string;
  readonly courseId?: string;
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly issuedOn: string;
  readonly validUntil?: string;
  /** `valid`, `expiring_soon`, `expired` or `no_expiry`. Derived against `asOf` (ADR-0070). */
  readonly validity: string;
  readonly evidenceDocumentId?: string;
  readonly issuedBy: string;
  readonly version: number;
}

export interface InstructorView {
  readonly instructorId: string;
  readonly employmentId?: string;
  readonly externalName?: LocalizedTextView;
  readonly externalOrganization?: string;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One person's learning record, assembled on read from the authoritative rows.
 *
 * **A projection, never a write path** (ADR-0008). Nothing writes this shape, nothing stores it and
 * no command takes it: it is what the authoritative tables say, arranged for a reader. A materialized
 * one would need maintaining from six places, and the first missed update would be a compliance
 * screen confidently showing training somebody never did.
 */
export interface LearningHistoryView {
  readonly employmentId: string;
  /** The day this was computed against. Every derived field below is relative to it. */
  readonly asOf: string;
  readonly assignments: readonly AssignmentView[];
  readonly enrolments: readonly EnrolmentView[];
  readonly certifications: readonly CertificationView[];
  readonly openAssignments: number;
  readonly overdueAssignments: number;
  readonly completedCourses: number;
  readonly activeCertifications: number;
  readonly expiringCertifications: number;
}

/**
 * What one reconciliation run did.
 *
 * **Nothing fires this** (ADR-0071). An administrator runs it, and `scheduled` is not a field here
 * because no schedule exists — scheduled execution is `NOT VERIFIED`.
 */
export interface ReconciliationView {
  readonly mandatoryRuleId: string;
  readonly asOf: string;
  /** How many employments the run looked at. Bounded; the caller pages. */
  readonly examined: number;
  readonly generated: number;
  /** Already present — the idempotent case, decided by the database and not by a check. */
  readonly alreadyPresent: number;
  /** Not due: inside the interval, or the rule has not taken effect for them. */
  readonly notDue: number;
  /** True where the bound was reached and more employments remain to examine. */
  readonly more: boolean;
}
