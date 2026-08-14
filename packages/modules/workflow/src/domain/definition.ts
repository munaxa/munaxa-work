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
  readonly description?: string;
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
 * One step of a version: who is asked, and when in the order.
 *
 * `approverKind` is `membership` and nothing else in 16A. The field exists rather than being implied
 * so that adding a kind in 16B is a migration and a vocabulary change somebody reviews, rather than
 * a new meaning quietly given to an existing column.
 */
export interface WorkflowStepTemplateState {
  readonly stepTemplateId: string;
  readonly workflowVersionId: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly approverKind: ApproverKind;
  /** The membership asked to decide. A person a tenant admitted, named individually (D-3). */
  readonly approverMembershipId: string;
  readonly version: number;
}

export interface CreateDefinitionRequest {
  readonly definitionId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly subjectType: string;
  readonly description?: string;
}

export const createDefinition = (
  request: CreateDefinitionRequest,
): WorkflowResult<WorkflowDefinitionState> => {
  if (!isCode(request.code)) return refuse('definition-code-invalid');
  if (!isLocalizedName(request.name)) return refuse('definition-name-required');
  if (!isSubjectType(request.subjectType)) return refuse('definition-subject-type-invalid');

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
  readonly approverMembershipId: string;
}

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

  return accept({
    stepTemplateId: request.stepTemplateId,
    workflowVersionId: version.workflowVersionId,
    ordinal: request.ordinal,
    name: request.name,
    approverKind: request.approverKind,
    approverMembershipId: request.approverMembershipId,
    version: 1,
  });
};

const versionPermits = (from: WorkflowVersionStatus, to: WorkflowVersionStatus): boolean =>
  WORKFLOW_VERSION_TRANSITIONS[from].includes(to);

/**
 * Whether a set of steps forms a usable order: contiguous ordinals from one.
 *
 * Separate from `publishVersion` so the rule can be read, tested and reused without a version state
 * to hand — and so the refusal it produces has one origin rather than being re-derived at each call
 * site.
 */
export const ordinalsAreContiguous = (steps: readonly WorkflowStepTemplateState[]): boolean => {
  const ordinals = [...steps].map((step) => step.ordinal).sort((left, right) => left - right);

  return ordinals.every((ordinal, index) => ordinal === index + 1);
};

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

  return accept({ ...state, status: 'published', publishedAt: at, publishedBy: by });
};

/** Archiving a version. New instances stop choosing it; running ones are untouched (AD-003). */
export const archiveVersion = (
  state: WorkflowVersionState,
): WorkflowResult<WorkflowVersionState> => {
  if (!versionPermits(state.status, 'archived')) return refuse('version-transition-refused');

  return accept({ ...state, status: 'archived' });
};
