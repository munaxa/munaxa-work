import type {
  ApproverKind,
  BranchRule,
  ConditionOperator,
  LocalizedName,
  WorkflowDefinitionStatus,
  WorkflowVersionStatus,
} from '../domain/workflow-vocabulary.js';
import type { ServiceLevelState, ServiceLevelUnit } from '../domain/service-level.js';

/**
 * What Workflow publishes about a process somebody **configured**: definitions, versions, step
 * templates and approval groups.
 *
 * The running half — instances, steps, decisions, history, the caller's queue, and the machine's
 * discovery read — is in `execution-views.ts`. The seam is the one this file already had a banner
 * for; the two halves change for different reasons, are read by different screens, and had grown past
 * the file budget as one. `index.ts` re-exports both, so the published contract is unchanged by the
 * split.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and one
 * that could reach a store could bypass its tenancy. Nothing here is a Prisma type or a row.
 *
 * There is no `escalationLevel` and no `pattern` here, for the same reason there is no column for
 * either. `StepServiceLevelView` exists because Phase 16C built the target, and it is **derived at
 * read time** — which is why it has no version and no identifier of its own: there is no due-time row
 * anywhere to be out of date.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

// ------------------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------------------

export interface WorkflowDefinitionView {
  readonly definitionId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly description?: LocalizedName;
  /** What a business module calls the thing being decided. Opaque, and never interpreted here. */
  readonly subjectType: string;
  readonly status: WorkflowDefinitionStatus;
  readonly retiredOn?: string;
  readonly version: number;
}

/**
 * One condition on a branch, in the closed form the domain evaluates.
 *
 * Published because an administrator reading a process needs to see *why* a stage might not run, and
 * a screen that showed a branch with no explanation would describe a process nobody could predict.
 * The value is a string or a whole number, or a list of either for `in` — there is no expression
 * here to render and none to write.
 */
export interface BranchConditionView {
  readonly key: string;
  readonly operator: ConditionOperator;
  readonly value: string | number | readonly (string | number)[];
}

/**
 * How a branch reaches an outcome, as configured.
 *
 * Absent `rule` means `unanimous` and absent `quorum` means one, which is exactly what every step
 * configured before Phase 16B is. The view states them as they were stored rather than filling the
 * defaults in, because a screen that showed `unanimous` on a step nobody configured that way would
 * be reporting a decision the tenant did not make.
 */
/**
 * How long a step is expected to take once it becomes awaiting, as configured.
 *
 * Two fields rather than a duration, because "two days" and "forty-eight hours" are the same length
 * of time and not the same sentence: an administrator typed one of them, and a screen has to show
 * them back what they typed. A whole count, never a fraction and never a proportion.
 *
 * **It is a target and not a deadline.** Nothing fires when it passes, no step becomes `expired`, and
 * no approval ends: what it buys is a question a reader can ask (D-16C-06).
 */
export interface ServiceLevelTargetView {
  readonly count: number;
  readonly unit: ServiceLevelUnit;
}

/**
 * How one running step stands against its target, **as at the instant it was read**.
 *
 * Every field below the unit is derived, at read time, from three things: the target, the instant the
 * step became awaiting, and the reading instant. None of them is stored — a written due time would
 * disagree with its own inputs the first time somebody corrected a target, and a written `overdue`
 * would need something to write it, which is a scheduler this phase does not have (D-16C-01) or a
 * synthetic actor ADR-0045 refuses (D-16C-02).
 *
 * **`state` has three values and `expired` is not one of them.** `none` is a step nobody is waiting
 * on yet, or one with no target at all. Due exactly on the boundary is `within`: two hours to approve
 * means two whole hours.
 *
 * **`overdueByMinutes` is a whole number, truncated.** A step three seconds past its target is
 * overdue by zero minutes and not by one, in a module where every published number is an integer and
 * none is a percentage. Absent while the step is within its target.
 */
export interface StepServiceLevelView {
  readonly count: number;
  readonly unit: ServiceLevelUnit;
  /** The instant this step became awaiting. Absent on a step nobody is waiting on. */
  readonly awaitingOn?: string;
  /** When it falls due, derived. Absent for the same reason `awaitingOn` is. */
  readonly dueOn?: string;
  readonly state: ServiceLevelState;
  readonly overdueByMinutes?: number;
}

export interface WorkflowStepTemplateView {
  readonly stepTemplateId: string;
  /** The branch this step is in. Several templates may share one; all of them are asked at once. */
  readonly ordinal: number;
  readonly name: LocalizedTextView;
  readonly approverKind: ApproverKind;
  /** Present when `approverKind` is `membership`. */
  readonly approverMembershipId?: string;
  /** Present when `approverKind` is `group`. Resolved into its members when an instance starts. */
  readonly approverGroupId?: string;
  /**
   * Absent when `approverKind` is `manager`, and there is no field that would be present instead.
   *
   * A manager template names nobody: whose manager it means is the person who raised the approval,
   * fixed rather than configured (P-1). A screen renders the kind and no identifier, because there is
   * no identifier — the person is resolved once, when an approval starts, and appears on its steps.
   */
  readonly branchRule?: BranchRule;
  /** A minimum number of responses before the rule is evaluated. A count, never a proportion. */
  readonly quorum?: number;
  readonly condition?: readonly BranchConditionView[];
  /** What was configured, exactly as configured. Absent means this step has no due time. */
  readonly serviceLevel?: ServiceLevelTargetView;
}

// ------------------------------------------------------------------------------------------------
// Approval groups
// ------------------------------------------------------------------------------------------------

/**
 * A named list of memberships a tenant maintains.
 *
 * **Not a directory.** There is no role here, no query, no nesting and no status: a group is a list
 * somebody wrote down, resolved into individual approvers when an approval starts and never
 * consulted again by one that is already running.
 */
export interface ApprovalGroupView {
  readonly approvalGroupId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly version: number;
}

export interface ApprovalGroupMemberView {
  readonly approvalGroupMemberId: string;
  readonly approvalGroupId: string;
  /** Identity's identifier, held as a value. Nothing here resolves it to a person or a position. */
  readonly membershipId: string;
  readonly addedOn: string;
}

/** One group with the memberships on it, in a deterministic order. */
export interface ApprovalGroupDetailView {
  readonly group: ApprovalGroupView;
  readonly members: readonly ApprovalGroupMemberView[];
}

export interface WorkflowVersionView {
  readonly workflowVersionId: string;
  readonly definitionId: string;
  readonly versionNumber: number;
  readonly status: WorkflowVersionStatus;
  readonly publishedOn?: string;
  readonly stepCount: number;
  readonly version: number;
}

/** One definition with its versions and the steps of whichever version is currently published. */
export interface WorkflowDefinitionDetailView {
  readonly definition: WorkflowDefinitionView;
  readonly versions: readonly WorkflowVersionView[];
  /** Absent where no version is published — a definition nothing can start an approval from. */
  readonly publishedSteps?: readonly WorkflowStepTemplateView[];
}
