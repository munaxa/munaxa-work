import type { BilingualText, Metadata } from '../domain/onboarding-aggregate.js';
import type {
  DueAnchor,
  OnboardingState,
  OwnerKind,
  PlanStatus,
  PlanVersionStatus,
  TaskEventKind,
  TaskKind,
  TaskStatus,
} from '../domain/onboarding-vocabulary.js';

/**
 * What Onboarding publishes, and the shape every consumer of it sees.
 *
 * Three omissions are the contract rather than accidents of scope.
 *
 * **No view carries a person's name.** An onboarding is about a named human being, and a task queue
 * is read by IT, Finance and Facilities. What these carry is an employment identifier; resolving it
 * to a name is People's read, behind People's permission.
 *
 * **No view carries an employment fact.** No status, no unit, no position, no manager, no employee
 * number. A consumer that needs those asks Employment as at a date — a copy here would be a second
 * answer that goes stale on the first transfer (ADR-0047).
 *
 * **Progress is computed, never stored.** `OnboardingProgressView` is an aggregate over the tasks at
 * the moment it is asked, which is why `overdue` can appear in it at all: a stored counter would
 * need a sweeper and would be wrong between sweeps.
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export interface PlanView {
  readonly planId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description?: BilingualText;
  readonly status: PlanStatus;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface PlanVersionView {
  readonly planVersionId: string;
  readonly planId: string;
  readonly versionNumber: number;
  readonly status: PlanVersionStatus;
  readonly publishedAt?: Date;
  /** Who froze this checklist. A publication nobody can be named for is not a control. */
  readonly publishedBy?: string;
  readonly version: number;
}

export interface TaskTemplateView {
  readonly templateId: string;
  readonly planVersionId: string;
  readonly code: string;
  readonly sequence: number;
  readonly title: BilingualText;
  readonly description?: BilingualText;
  readonly kind: TaskKind;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly required: boolean;
  readonly dueAnchor: DueAnchor;
  readonly dueOffsetDays: number;
  readonly dependsOnTemplateCode?: string;
  readonly documentTypeCode?: string;
  readonly version: number;
}

export interface PlanSnapshot {
  readonly plan: PlanView;
  readonly versions: readonly PlanVersionView[];
  /** The templates of the version asked for, or of the published one. */
  readonly templates: readonly TaskTemplateView[];
}

export interface OnboardingView {
  readonly onboardingId: string;
  /** Employment's, by identifier. Nothing about the employment is copied here. */
  readonly employmentId: string;
  readonly personId: string;
  readonly applicationId?: string;
  readonly planId?: string;
  /** Which checklist this onboarding was actually generated from (ADR-0048). */
  readonly planVersionId?: string;
  readonly state: OnboardingState;
  readonly plannedStartOn: string;
  readonly employmentStartOn?: string;
  readonly completedOn?: string;
  readonly completedBy?: string;
  readonly cancellationReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface TaskView {
  readonly taskId: string;
  readonly onboardingId: string;
  readonly templateCode?: string;
  readonly sequence: number;
  readonly title: BilingualText;
  readonly description?: BilingualText;
  readonly kind: TaskKind;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly required: boolean;
  readonly status: TaskStatus;
  readonly dueOn?: string;
  readonly dependsOnTaskId?: string;
  /** A reference into the document store. This module holds no bytes and returns none. */
  readonly documentReference?: string;
  readonly documentTypeCode?: string;
  readonly completedAt?: Date;
  readonly completedBy?: string;
  readonly completionNote?: string;
  readonly waiverReasonCode?: string;
  readonly version: number;
}

export interface TaskEventView {
  readonly eventId: string;
  readonly taskId: string;
  readonly onboardingId: string;
  readonly kind: TaskEventKind;
  readonly fromStatus?: TaskStatus;
  readonly toStatus?: TaskStatus;
  readonly detail?: string;
  readonly occurredAt: Date;
  readonly recordedBy: string;
}

/**
 * How far an onboarding has got, counted at the moment it is asked.
 *
 * Required and optional are separate numbers because only the first decides completion, and the
 * per-owner outstanding counts are what "the manager has finished but HR has not" means in a figure
 * somebody can act on.
 */
export interface OnboardingProgressView {
  readonly onboardingId: string;
  readonly requiredTotal: number;
  readonly requiredSatisfied: number;
  readonly requiredOverdue: number;
  readonly optionalTotal: number;
  readonly optionalSatisfied: number;
  readonly outstandingByOwnerKind: Readonly<Record<string, number>>;
  /** True when every required task is `done` or `waived` — what completion refuses without. */
  readonly readyToComplete: boolean;
}

export interface OnboardingSnapshot {
  readonly onboarding: OnboardingView;
  readonly tasks: readonly TaskView[];
  readonly progress: OnboardingProgressView;
}

/** What an export produces. No names, and no document references. */
export interface OnboardingExport {
  readonly generatedAt: Date;
  readonly onboardings: readonly OnboardingView[];
  readonly tasks: readonly TaskView[];
}
