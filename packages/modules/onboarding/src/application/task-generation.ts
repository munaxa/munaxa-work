import type { Transaction } from '@work/kernel';

import { Task } from '../domain/task.js';
import { addDays } from '../domain/onboarding-vocabulary.js';
import { taskEvent } from '../domain/task-event.js';
import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { TaskTemplateState } from '../domain/plan-version.js';
import type { OwnerKind } from '../domain/onboarding-vocabulary.js';

import { currentActor, currentTenant, originOfCurrentRequest } from './onboarding-context.js';
import type { EmploymentForOnboarding } from './onboarding-ports.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Turning a plan version's templates into an onboarding's tasks.
 *
 * **This is the copy that makes plan versioning work.** Tasks are rows on the instance from the
 * moment it is generated; nothing afterwards reads the template again. An administrator improving
 * next quarter's checklist changes a *version*, and the joiner who started last week keeps the list
 * they were actually given (ADR-0048).
 *
 * Two resolutions happen here and nowhere else:
 *
 * **The owner is resolved once.** `employee` becomes the joiner's own employment, `manager` becomes
 * whoever is on their reporting line *now*. Snapshotting the manager is deliberate: a reorganization
 * three weeks later must not silently move a task somebody already answered for, and moving it is a
 * deliberate reassignment that leaves a history row.
 *
 * **The due date is computed once**, from the template's anchor and offset, in **calendar days**.
 * Working days would need Organization's calendar, which publishes no read for it, and a week-end
 * rule invented here would be country logic in a business module (00B). The limitation is recorded
 * rather than approximated.
 */

export interface GeneratedTasks {
  readonly created: number;
}

export const generateTasks = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  onboarding: OnboardingInstanceState,
  templates: readonly TaskTemplateState[],
  employment: EmploymentForOnboarding,
): Promise<GeneratedTasks> => {
  const now = dependencies.clock.now();
  const ordered = [...templates].sort((left, right) => left.sequence - right.sequence);
  const byCode = new Map<string, string>();
  let created = 0;

  for (const template of ordered) {
    const owner = ownerFor(template, onboarding, employment);
    const predecessor =
      template.dependsOnTemplateCode === undefined
        ? undefined
        : byCode.get(template.dependsOnTemplateCode);
    const task = Task.define(
      {
        tenantId: currentTenant(),
        onboardingId: onboarding.id,
        templateCode: template.code,
        sequence: template.sequence,
        title: template.title,
        ...(template.description === undefined ? {} : { description: template.description }),
        kind: template.kind,
        ...owner,
        required: template.required,
        dueOn: dueDateFor(template, onboarding),
        ...(predecessor === undefined ? {} : { dependsOnTaskId: predecessor }),
        ...(template.documentTypeCode === undefined
          ? {}
          : { documentTypeCode: template.documentTypeCode }),
        metadata: template.metadata,
      },
      originOfCurrentRequest(),
      now,
    );

    if (!task.ok) continue;

    await persist(transaction, dependencies, task.value, now);
    byCode.set(template.code, task.value.id);
    created += 1;
  }
  return { created };
};

/**
 * Writes the task and the first row of its history, in the transaction that created it.
 *
 * The history begins where the task does. A task whose first recorded movement is its completion is
 * a task nobody can show was ever assigned to the person who completed it.
 */
const persist = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  task: Task,
  now: Date,
): Promise<void> => {
  await dependencies.stores.tasks.insert(transaction, task.snapshot());
  await dependencies.stores.taskEvents.insert(
    transaction,
    taskEvent(
      {
        tenantId: currentTenant(),
        taskId: task.id,
        onboardingId: task.onboardingId,
        kind: 'created',
        toStatus: task.status,
        occurredAt: now,
        recordedBy: currentActor(),
      },
      now,
    ),
  );
  transaction.collect(task.pullEvents());
};

/**
 * Who the task belongs to, resolved from the template's kind.
 *
 * A `manager` template on an employment with no manager recorded falls back to the `employee`'s own
 * HR queue rather than producing a task nobody owns — no: it falls back to an **unowned employment
 * reference of the joiner**, which is visible and reassignable. A task with no owner is a task
 * nobody sees, and on somebody's first week that is the failure that matters.
 */
const ownerFor = (
  template: TaskTemplateState,
  onboarding: OnboardingInstanceState,
  employment: EmploymentForOnboarding,
): { readonly ownerKind: OwnerKind; readonly ownerRef?: string; readonly ownerRole?: string } => {
  if (template.ownerKind === 'employee') {
    return { ownerKind: 'employee', ownerRef: onboarding.employmentId };
  }
  if (template.ownerKind === 'manager') {
    return {
      ownerKind: 'manager',
      ownerRef: employment.managerEmploymentId ?? onboarding.employmentId,
    };
  }
  if (template.ownerKind === 'role') {
    return { ownerKind: 'role', ...(template.ownerRole === undefined ? {} : { ownerRole: template.ownerRole }) };
  }
  return {
    ownerKind: template.ownerKind,
    ...(template.ownerRef === undefined ? {} : { ownerRef: template.ownerRef }),
  };
};

/**
 * When it is due: the anchor plus the offset, in calendar days.
 *
 * `employment_start` with no employment start date recorded falls back to the planned start, which
 * is the only other date this module has. A task with no due date at all would drop out of every
 * overdue query, which is the quiet failure.
 */
const dueDateFor = (
  template: TaskTemplateState,
  onboarding: OnboardingInstanceState,
): string => {
  const anchor =
    template.dueAnchor === 'employment_start'
      ? (onboarding.employmentStartOn ?? onboarding.plannedStartOn)
      : onboarding.plannedStartOn;

  return addDays(anchor, template.dueOffsetDays);
};
