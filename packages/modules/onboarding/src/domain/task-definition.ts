import {
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  optionalBilingualFrom,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './onboarding-aggregate.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import {
  OWNER_KINDS,
  TASK_KINDS,
  type OwnerKind,
  type TaskKind,
  type TaskStatus,
} from './onboarding-vocabulary.js';

/**
 * A task's state, and the checks a definition passes before one exists.
 *
 * Apart from the aggregate so neither file exceeds its budget, and because the checks are a pure
 * function over a request: they are the same whether a task is generated from a template or added
 * by hand to a running onboarding, and writing them twice is how the two paths drift.
 */

export interface TaskState {
  readonly id: string;
  readonly tenantId: string;
  readonly onboardingId: string;
  /** The template it came from. Absent for a task added to a running onboarding. */
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
  /** A civil date. Overdue is derived from it, never stored. */
  readonly dueOn?: string;
  readonly dependsOnTaskId?: string;
  readonly documentReference?: string;
  readonly documentTypeCode?: string;
  /** Reserved for Workflow (Phase 16). Null while Onboarding records the decision directly. */
  readonly approvalReference?: string;
  readonly completedAt?: Date;
  readonly completedBy?: string;
  readonly completionNote?: string;
  readonly waiverReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineTask {
  readonly tenantId: string;
  readonly onboardingId: string;
  readonly templateCode?: string;
  readonly sequence: number;
  readonly title: BilingualInput;
  readonly description?: BilingualInput;
  readonly kind: TaskKind;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly required?: boolean;
  readonly dueOn?: string;
  readonly dependsOnTaskId?: string;
  readonly documentTypeCode?: string;
  readonly metadata?: Metadata;
}

type CheckedTask = Omit<TaskState, 'id' | 'tenantId' | 'onboardingId' | 'status' | 'version'>;

export const checkedTaskDefinition = (request: DefineTask): OnboardingResult<CheckedTask> => {
  const identity = checkedIdentity(request);

  if (!identity.ok) return identity;

  const owner = checkedOwner(request);

  if (!owner.ok) return owner;

  const schedule = checkedSchedule(request);

  if (!schedule.ok) return schedule;

  return accept({
    ...identity.value,
    ...owner.value,
    ...schedule.value,
    required: request.required ?? true,
  });
};

/** What the task is called, what kind it is, and where it sits in the list. */
const checkedIdentity = (
  request: DefineTask,
): OnboardingResult<
  Pick<CheckedTask, 'title' | 'kind' | 'sequence' | 'metadata'> &
    Partial<Pick<CheckedTask, 'description' | 'templateCode' | 'documentTypeCode'>>
> => {
  const title = bilingualFrom(request.title, 'title');

  if (!title.ok) return title;

  const description = optionalBilingualFrom(request.description, 'description');

  if (!description.ok) return description;

  const codes = checkedCodes(request);

  if (!codes.ok) return codes;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    title: title.value,
    ...(description.value === undefined ? {} : { description: description.value }),
    kind: request.kind,
    sequence: request.sequence,
    ...codes.value,
    metadata: metadata.value,
  });
};

/**
 * The kind, the position, and the two codes a task may carry.
 *
 * One function because they are one question — "is this a coherent thing to ask somebody to do".
 * A `document` task with no document type is refused here rather than at completion: the person
 * completing it would otherwise be guessing which document was meant, on somebody's first day.
 */
const checkedCodes = (
  request: DefineTask,
): OnboardingResult<Partial<Pick<CheckedTask, 'templateCode' | 'documentTypeCode'>>> => {
  if (!TASK_KINDS.includes(request.kind)) return refuse('task_kind_unknown');
  if (!Number.isInteger(request.sequence) || request.sequence < 1) {
    return refuse('task_sequence_out_of_range');
  }

  const templateCode = checkedOptionalCode(request.templateCode, 'templateCode');

  if (!templateCode.ok) return templateCode;

  const documentTypeCode = checkedOptionalCode(request.documentTypeCode, 'documentTypeCode');

  if (!documentTypeCode.ok) return documentTypeCode;
  if (request.kind === 'document' && documentTypeCode.value === undefined) {
    return refuse('document_task_needs_a_type');
  }

  return accept({
    ...(templateCode.value === undefined ? {} : { templateCode: templateCode.value }),
    ...(documentTypeCode.value === undefined ? {} : { documentTypeCode: documentTypeCode.value }),
  });
};

/**
 * Who it belongs to.
 *
 * By the time a task exists, `employee` and `manager` have been *resolved* into an employment
 * identifier by the caller — the joiner's own, and the manager on their reporting line at the moment
 * tasks were generated. The kind is kept so a screen can say "the manager" rather than a UUID, and
 * so a later reorganization does not silently move a task somebody already answered for.
 */
const checkedOwner = (
  request: DefineTask,
): OnboardingResult<Pick<CheckedTask, 'ownerKind'> & Partial<Pick<CheckedTask, 'ownerRef' | 'ownerRole'>>> => {
  if (!OWNER_KINDS.includes(request.ownerKind)) return refuse('owner_kind_unknown');

  const ownerRole = checkedOptionalCode(request.ownerRole, 'ownerRole');

  if (!ownerRole.ok) return ownerRole;

  if (request.ownerKind === 'role') {
    if (ownerRole.value === undefined) return refuse('role_owner_needs_a_role');
    if (request.ownerRef !== undefined) return refuse('role_owner_takes_no_reference');
    return accept({ ownerKind: 'role', ownerRole: ownerRole.value });
  }
  if (request.ownerRef === undefined) return refuse('owner_reference_required');
  return accept({ ownerKind: request.ownerKind, ownerRef: request.ownerRef });
};

const checkedSchedule = (
  request: DefineTask,
): OnboardingResult<Partial<Pick<CheckedTask, 'dueOn' | 'dependsOnTaskId'>>> => {
  const dueOn = checkedOptionalCivilDate(request.dueOn, 'dueOn');

  if (!dueOn.ok) return dueOn;

  return accept({
    ...(dueOn.value === undefined ? {} : { dueOn: dueOn.value }),
    ...(request.dependsOnTaskId === undefined ? {} : { dependsOnTaskId: request.dependsOnTaskId }),
  });
};

/** A waiver, a cancellation and a document type are codes, checked the same way everywhere. */
export const checkedReasonCode = (value: string, field: string): OnboardingResult<string> =>
  checkedCode(value, field);
