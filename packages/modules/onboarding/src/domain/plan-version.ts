import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  OnboardingAggregate,
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  optionalBilingualFrom,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './onboarding-aggregate.js';
import { OnboardingEvents } from './onboarding-events.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import {
  DUE_ANCHORS,
  OWNER_KINDS,
  TASK_KINDS,
  type DueAnchor,
  type OwnerKind,
  type PlanVersionStatus,
  type TaskKind,
} from './onboarding-vocabulary.js';

/**
 * One version of an onboarding plan, and the templates it holds.
 *
 * **Immutable once published**, and that is the mechanism the whole plan model rests on. An
 * administrator improving the checklist creates the *next* version; the published one stays exactly
 * as it was, because instances were generated from it and an auditor will read it (ADR-0048).
 *
 * A version is an aggregate rather than a child of the plan because it has its own lifecycle — it
 * is drafted, edited, published and eventually superseded — and because the templates it holds are
 * its consistency boundary: adding a template to a published version has to be refused as one
 * decision, not as a race between two.
 */

export interface PlanVersionState {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly versionNumber: number;
  readonly status: PlanVersionStatus;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly version: number;
}

export class PlanVersion extends OnboardingAggregate {
  private constructor(private state: PlanVersionState) {
    super(state.id, state.tenantId, state.version, 'OnboardingPlanVersion');
  }

  public static draft(
    request: { readonly tenantId: string; readonly planId: string; readonly versionNumber: number },
    occurredAt: Date,
  ): OnboardingResult<PlanVersion> {
    if (!Number.isInteger(request.versionNumber) || request.versionNumber < 1) {
      return refuse('plan_version_number_out_of_range');
    }
    return accept(
      new PlanVersion({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        planId: request.planId,
        versionNumber: request.versionNumber,
        status: 'draft',
        version: 0,
      }),
    );
  }

  public static rehydrate(state: PlanVersionState): PlanVersion {
    return new PlanVersion(state);
  }

  public get status(): PlanVersionStatus {
    return this.state.status;
  }

  public get planId(): string {
    return this.state.planId;
  }

  public get versionNumber(): number {
    return this.state.versionNumber;
  }

  /** Whether a template may still be added, amended or removed. The answer for a draft, only. */
  public get isEditable(): boolean {
    return this.state.status === 'draft';
  }

  /**
   * Publishes the version, naming who published it.
   *
   * The actor comes from the authenticated context and is written here, not supplied: a publication
   * a caller could attribute to somebody else is not evidence that anybody reviewed the checklist
   * a hundred joiners are about to be measured against.
   *
   * A version with no templates is refused. Publishing an empty checklist produces onboardings that
   * complete the moment they begin, which is worse than having no plan at all — it looks like a
   * process ran.
   */
  public publish(
    templateCount: number,
    publishedBy: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<PlanVersionStatus> {
    if (this.state.status !== 'draft') return refuse('plan_version_not_draft');
    if (templateCount === 0) return refuse('plan_version_has_no_tasks');

    this.state = {
      ...this.state,
      status: 'published',
      publishedAt: occurredAt,
      publishedBy,
    };
    this.raise(
      OnboardingEvents.planPublished,
      {
        planId: this.state.planId,
        planVersionId: this.id,
        versionNumber: this.state.versionNumber,
      },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /** Replaced by a later published version. Instances generated from it are untouched. */
  public supersede(): OnboardingResult<PlanVersionStatus> {
    if (this.state.status !== 'published') return refuse('plan_version_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state.status);
  }

  public snapshot(): PlanVersionState {
    return { ...this.state, version: this.version };
  }
}

/**
 * What a version asks for: one task, described before anybody exists to do it.
 *
 * A plain shape rather than an aggregate, because a template only ever changes as part of the
 * version that holds it — and once that version is published, never again.
 */
export interface TaskTemplateState {
  readonly id: string;
  readonly tenantId: string;
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
  /** One predecessor, by code. A dependency graph is a workflow engine (ADR-0049). */
  readonly dependsOnTemplateCode?: string;
  readonly documentTypeCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineTaskTemplate {
  readonly tenantId: string;
  readonly planVersionId: string;
  readonly code: string;
  readonly sequence: number;
  readonly title: BilingualInput;
  readonly description?: BilingualInput;
  readonly kind: TaskKind;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly required?: boolean;
  readonly dueAnchor?: DueAnchor;
  readonly dueOffsetDays?: number;
  readonly dependsOnTemplateCode?: string;
  readonly documentTypeCode?: string;
  readonly metadata?: Metadata;
}

const MAX_OFFSET_DAYS = 365;

export const taskTemplate = (
  request: DefineTaskTemplate,
  occurredAt: Date,
): OnboardingResult<TaskTemplateState> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const identity = checkedTemplateIdentity(request);

  if (!identity.ok) return identity;

  const owner = checkedOwner(request);

  if (!owner.ok) return owner;

  const schedule = checkedSchedule(request);

  if (!schedule.ok) return schedule;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    planVersionId: request.planVersionId,
    code: code.value,
    ...identity.value,
    ...owner.value,
    ...schedule.value,
    required: request.required ?? true,
    version: 0,
  });
};

/** What the task is called and what kind of thing it is. */
const checkedTemplateIdentity = (
  request: DefineTaskTemplate,
): OnboardingResult<
  Pick<TaskTemplateState, 'title' | 'kind' | 'sequence' | 'metadata'> &
    Partial<Pick<TaskTemplateState, 'description' | 'documentTypeCode'>>
> => {
  const title = bilingualFrom(request.title, 'title');

  if (!title.ok) return title;

  const description = optionalBilingualFrom(request.description, 'description');

  if (!description.ok) return description;

  const kind = checkedKind(request.kind, request.sequence, request.documentTypeCode);

  if (!kind.ok) return kind;

  const documentTypeCode = kind.value;
  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    title: title.value,
    ...(description.value === undefined ? {} : { description: description.value }),
    kind: request.kind,
    sequence: request.sequence,
    ...(documentTypeCode === undefined ? {} : { documentTypeCode }),
    metadata: metadata.value,
  });
};

/**
 * The kind, where it sits in the list, and the document type its kind may require.
 *
 * Together because they are one question — "is this a coherent thing to ask somebody to do" — and
 * because a document task that does not say what document it wants is a task nobody can complete
 * correctly, with the person completing it guessing on somebody's first day.
 */
const checkedKind = (
  kind: TaskKind,
  sequence: number,
  documentTypeCode: string | undefined,
): OnboardingResult<string | undefined> => {
  if (!TASK_KINDS.includes(kind)) return refuse('task_kind_unknown');
  if (!Number.isInteger(sequence) || sequence < 1) return refuse('task_sequence_out_of_range');

  const code = checkedOptionalCode(documentTypeCode, 'documentTypeCode');

  if (!code.ok) return code;
  if (kind === 'document' && code.value === undefined) return refuse('document_task_needs_a_type');
  return accept(code.value);
};

/**
 * Who the task belongs to, checked so the parts agree.
 *
 * `employee` and `manager` are resolved per onboarding and carry no reference here. `employment` and
 * `unit` name one. `role` names a queue. The database says the same thing with a check constraint,
 * so a task can never reach a screen with an owner nobody can resolve.
 */
const checkedOwner = (
  request: DefineTaskTemplate,
): OnboardingResult<
  Pick<TaskTemplateState, 'ownerKind'> & Partial<Pick<TaskTemplateState, 'ownerRef' | 'ownerRole'>>
> => {
  if (!OWNER_KINDS.includes(request.ownerKind)) return refuse('owner_kind_unknown');

  const ownerRole = checkedOptionalCode(request.ownerRole, 'ownerRole');

  if (!ownerRole.ok) return ownerRole;

  if (request.ownerKind === 'role') return checkedRoleOwner(request.ownerRef, ownerRole.value);
  if (request.ownerKind === 'employment' || request.ownerKind === 'unit') {
    if (request.ownerRef === undefined) return refuse('owner_reference_required');
    return accept({ ownerKind: request.ownerKind, ownerRef: request.ownerRef });
  }
  if (request.ownerRef !== undefined || ownerRole.value !== undefined) {
    return refuse('resolved_owner_takes_no_reference');
  }
  return accept({ ownerKind: request.ownerKind });
};

/** A queue: anybody holding the matching permission may complete it, so it names no individual. */
const checkedRoleOwner = (
  ownerRef: string | undefined,
  ownerRole: string | undefined,
): OnboardingResult<Pick<TaskTemplateState, 'ownerKind'> & { readonly ownerRole: string }> => {
  if (ownerRole === undefined) return refuse('role_owner_needs_a_role');
  if (ownerRef !== undefined) return refuse('role_owner_takes_no_reference');
  return accept({ ownerKind: 'role', ownerRole });
};

/** When it is due, and what it waits for. */
const checkedSchedule = (
  request: DefineTaskTemplate,
): OnboardingResult<
  Pick<TaskTemplateState, 'dueAnchor' | 'dueOffsetDays'> &
    Partial<Pick<TaskTemplateState, 'dependsOnTemplateCode'>>
> => {
  const anchor = request.dueAnchor ?? 'employment_start';

  if (!DUE_ANCHORS.includes(anchor)) return refuse('due_anchor_unknown');

  const offset = request.dueOffsetDays ?? 0;

  if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET_DAYS) {
    return refuse('due_offset_out_of_range');
  }

  const dependsOn = checkedOptionalCode(request.dependsOnTemplateCode, 'dependsOnTemplateCode');

  if (!dependsOn.ok) return dependsOn;
  if (dependsOn.value === request.code) return refuse('task_cannot_depend_on_itself');

  return accept({
    dueAnchor: anchor,
    dueOffsetDays: offset,
    ...(dependsOn.value === undefined ? {} : { dependsOnTemplateCode: dependsOn.value }),
  });
};
