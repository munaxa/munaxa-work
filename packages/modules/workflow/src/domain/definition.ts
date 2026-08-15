import {
  WORKFLOW_DEFINITION_TRANSITIONS,
  WORKFLOW_VERSION_TRANSITIONS,
  isCode,
  isLocalizedName,
  isPositiveWhole,
  isSubjectType,
  type ApproverKind,
  type LocalizedName,
  type WorkflowDefinitionStatus,
  type WorkflowVersionStatus,
} from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { definedOf } from './defined.js';
import { branchesAreCoherent, ordinalsAreContiguous } from './branch.js';
import { conditionsAreWellFormed, type BranchCondition } from './condition.js';
import type { BranchRule } from './workflow-vocabulary.js';

/**
 * A reusable process a tenant configured, and the versions of it.
 *
 * **A definition names what it decides, never what it decides about.** `subjectType` is the opaque
 * string a business module supplies through `ApprovalPort` — `recruitment.requisition`. Workflow
 * validates its shape and stores it; it holds no list of legal subject types, because such a list
 * would be a list of business modules and this module is required to know about none of them
 * (AD-001).
 *
 * **A published version is immutable, and that is the whole of AD-003.** Steps may be added while a
 * version is a draft and never afterwards; there is no `published → draft` transition; and an
 * instance **copies** its steps at creation (see `instance.ts`) rather than pointing at the
 * version's. Archiving the definition, retiring it, or publishing a tenth version therefore changes
 * nothing about an approval that is half-finished. This is Onboarding's construction (ADR-0048),
 * which faced the same problem and solved it the same way.
 *
 * **Publishing a version with no steps is refused.** A process with nothing to approve, presented as
 * publishable, would start instances that complete instantly and record that a chain considered
 * something — which is `AutoApprovingPort`'s dishonesty rebuilt in a tenant's configuration. Career
 * refuses to publish a path with no stages and to activate a bench with nobody on it for the same
 * reason.
 *
 * **Step ordinals are exactly 1..n at publication.** Not "unique", not "ordered": contiguous from
 * one. That is what makes "advance to the next step" a total function rather than a search, and it
 * is checked once, at the moment the version stops being editable. There is **no maximum** — AD-004
 * forbids a hardcoded approval limit, so `isPositiveWhole` bounds below and not above.
 */

export interface WorkflowDefinitionState {
  readonly definitionId: string;
  readonly code: string;
  readonly name: LocalizedName;
  /** What a business module calls the thing being decided. Opaque here, and never interpreted. */
  readonly subjectType: string;
  readonly status: WorkflowDefinitionStatus;
  /**
   * A tenant-authored explanation of the process, in both first-class languages.
   *
   * `LocalizedName` rather than a plain string, matching the `name` beside it and Career's, Learning's
   * and Onboarding's descriptions: this product renders tenant text and never translates it, so a
   * single-language description would be a screen in the wrong language for half the organization.
   * The column has always been `jsonb`; this is the domain saying the same thing.
   */
  readonly description?: LocalizedName;
  readonly retiredAt?: Date;
  readonly retiredBy?: string;
  readonly version: number;
}

export interface WorkflowVersionState {
  readonly workflowVersionId: string;
  readonly definitionId: string;
  /** The tenant-visible version number. Monotonic per definition; uniqueness is an index's job. */
  readonly versionNumber: number;
  readonly status: WorkflowVersionStatus;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly version: number;
}

/**
 * One step of a version: who is asked, when in the order, and under what rule.
 *
 * **The ordinal is a branch rather than a position.** Several templates may share one, and every
 * template sharing an ordinal is asked at the same moment the instance reaches it. A version whose
 * ordinals are all distinct is exactly a 16A sequential chain, which is why every process configured
 * before this phase keeps behaving identically.
 *
 * **`approverKind` decides which of the two approver fields is present**, and exactly one is. A
 * `membership` template names a person; a `group` template names a list Workflow keeps, resolved
 * into its members when an instance starts and never consulted again.
 *
 * **The branch rule and quorum are carried on the template rather than on a branch row.** A branch
 * has no identity of its own — it is a fact about a set of steps sharing an ordinal — and giving it
 * a row would create a second thing that has to agree with the steps. What that costs is a coherence
 * rule: every template at one ordinal must state the same rule, checked at publication, where the
 * set is finally complete.
 */
export interface WorkflowStepTemplateState {
  readonly stepTemplateId: string;
  readonly workflowVersionId: string;
  /** The branch this step belongs to. Shared with every other template asked at the same time. */
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly approverKind: ApproverKind;
  /** Present when `approverKind` is `membership`: the person asked to decide. */
  readonly approverMembershipId?: string;
  /** Present when `approverKind` is `group`: the list resolved at instance start. */
  readonly approverGroupId?: string;
  /** How this ordinal's branch reaches an outcome. Absent means `unanimous`, which is 16A's rule. */
  readonly branchRule?: BranchRule;
  /** A minimum number of responses before the rule is evaluated. Absent means one. */
  readonly quorum?: number;
  /** Every condition that must hold for this branch to run at all. Absent means it always runs. */
  readonly condition?: readonly BranchCondition[];
  readonly version: number;
}

export interface CreateDefinitionRequest {
  readonly definitionId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly subjectType: string;
  readonly description?: LocalizedName;
}

export const createDefinition = (
  request: CreateDefinitionRequest,
): WorkflowResult<WorkflowDefinitionState> => {
  if (!isCode(request.code)) return refuse('definition-code-invalid');
  if (!isLocalizedName(request.name)) return refuse('definition-name-required');
  if (!isSubjectType(request.subjectType)) return refuse('definition-subject-type-invalid');
  // Optional, but not therefore unchecked: a description that is present must be a description in
  // both languages. `isLocalizedName` refuses a missing language and a blank one alike, which is
  // what stops `{ en: 'Hiring', ar: '' }` from reaching a `jsonb` column and rendering as nothing.
  if (request.description !== undefined && !isLocalizedName(request.description)) {
    return refuse('definition-description-invalid');
  }

  return accept({
    definitionId: request.definitionId,
    code: request.code,
    name: request.name,
    subjectType: request.subjectType,
    status: 'active',
    version: 1,
    ...definedOf({ description: request.description }),
  });
};

const definitionPermits = (from: WorkflowDefinitionStatus, to: WorkflowDefinitionStatus): boolean =>
  WORKFLOW_DEFINITION_TRANSITIONS[from].includes(to);

/**
 * Retiring a definition.
 *
 * Terminal, and it stops nothing that is already running. AD-003 says an instance continues on the
 * version that started it, and since the instance holds its own copy of the steps there is nothing
 * for retirement to pull out from under it.
 */
export const retireDefinition = (
  state: WorkflowDefinitionState,
  at: Date,
  by: string,
): WorkflowResult<WorkflowDefinitionState> => {
  if (!definitionPermits(state.status, 'retired')) return refuse('definition-transition-refused');

  return accept({ ...state, status: 'retired', retiredAt: at, retiredBy: by });
};

export interface DraftVersionRequest {
  readonly workflowVersionId: string;
  readonly versionNumber: number;
}

/** A new draft against a definition. Refused once the definition is retired. */
export const draftVersion = (
  definition: WorkflowDefinitionState,
  request: DraftVersionRequest,
): WorkflowResult<WorkflowVersionState> => {
  if (definition.status === 'retired') return refuse('definition-retired');
  if (!isPositiveWhole(request.versionNumber)) return refuse('version-number-invalid');

  return accept({
    workflowVersionId: request.workflowVersionId,
    definitionId: definition.definitionId,
    versionNumber: request.versionNumber,
    status: 'draft',
    version: 1,
  });
};

export interface AddStepRequest {
  readonly stepTemplateId: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchCondition[];
}

/**
 * Exactly one approver field, and the right one for the kind.
 *
 * Both present is the dangerous case rather than the untidy one: a template naming a person *and* a
 * group has two readings, and whichever one an implementation happened to pick would decide who
 * approves. Refused outright rather than resolved by precedence.
 */
const approverIsCoherent = (request: AddStepRequest): WorkflowResult<ApproverKind> => {
  if (request.approverKind === 'membership') {
    if (request.approverGroupId !== undefined) return refuse('step-approver-ambiguous');
    if ((request.approverMembershipId ?? '').trim() === '') return refuse('step-approver-required');
    return accept('membership');
  }

  if (request.approverMembershipId !== undefined) return refuse('step-approver-ambiguous');
  if ((request.approverGroupId ?? '').trim() === '') return refuse('step-approver-required');
  return accept('group');
};

/**
 * Adding a step to a draft.
 *
 * Refused on a published or archived version, which is where AD-003's immutability actually bites.
 * **Ordinal uniqueness is not checked here**: one step per ordinal per version is a fact about a set
 * of rows, arbitrated by a partial unique index, because two administrators can add a step at the
 * same instant and a pre-check would let both through. Career took the same position on duplicate
 * nominations.
 */
export const addStep = (
  version: WorkflowVersionState,
  request: AddStepRequest,
): WorkflowResult<WorkflowStepTemplateState> => {
  if (version.status !== 'draft') return refuse('version-not-editable');
  if (!isPositiveWhole(request.ordinal)) return refuse('step-ordinal-invalid');
  if (!isLocalizedName(request.name)) return refuse('step-name-required');

  const approver = approverIsCoherent(request);

  if (!approver.ok) return refuse(approver.error.reason);
  if (request.quorum !== undefined && !isPositiveWhole(request.quorum)) {
    return refuse('branch-quorum-invalid');
  }
  // Shape only. Whether a branch's conditions can be *evaluated* depends on a request's context and
  // is answered when an instance starts; whether they are well formed is an administrator's mistake,
  // caught while they are still editing.
  const conditions = conditionsAreWellFormed(request.condition ?? []);

  if (!conditions.ok) return refuse(conditions.error.reason, conditions.error.detail);

  return accept({
    stepTemplateId: request.stepTemplateId,
    workflowVersionId: version.workflowVersionId,
    ordinal: request.ordinal,
    name: request.name,
    approverKind: request.approverKind,
    version: 1,
    ...definedOf({
      approverMembershipId: request.approverMembershipId,
      approverGroupId: request.approverGroupId,
      branchRule: request.branchRule,
      quorum: request.quorum,
      condition: request.condition,
    }),
  });
};

const versionPermits = (from: WorkflowVersionStatus, to: WorkflowVersionStatus): boolean =>
  WORKFLOW_VERSION_TRANSITIONS[from].includes(to);

export { ordinalsAreContiguous } from './branch.js';

/**
 * Publishing a version: the moment it stops being editable and starts being followed.
 *
 * Three refusals, and each is a real mistake rather than a hypothetical one. An **empty** version
 * would approve everything instantly while looking like a process. A **gapped or duplicated** order
 * would make "the next step" ambiguous at the one moment nobody is watching. And a version already
 * published cannot be published again, because the second publication would move `publishedAt` on a
 * record instances are already following.
 */
export const publishVersion = (
  state: WorkflowVersionState,
  steps: readonly WorkflowStepTemplateState[],
  at: Date,
  by: string,
): WorkflowResult<WorkflowVersionState> => {
  if (!versionPermits(state.status, 'published')) return refuse('version-transition-refused');
  if (steps.length === 0) return refuse('version-has-no-steps');
  if (!ordinalsAreContiguous(steps)) return refuse('version-step-order-broken');

  // Every branch must agree with itself about how it ends. Checked here rather than in `addStep`
  // because a branch is a property of a set of steps, and the set is not complete until now.
  const coherent = branchesAreCoherent(steps);

  if (!coherent.ok) return refuse(coherent.error.reason, coherent.error.detail);

  return accept({ ...state, status: 'published', publishedAt: at, publishedBy: by });
};

/** Archiving a version. New instances stop choosing it; running ones are untouched (AD-003). */
export const archiveVersion = (
  state: WorkflowVersionState,
): WorkflowResult<WorkflowVersionState> => {
  if (!versionPermits(state.status, 'archived')) return refuse('version-transition-refused');

  return accept({ ...state, status: 'archived' });
};
