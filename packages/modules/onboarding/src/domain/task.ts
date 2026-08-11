import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  OnboardingAggregate,
  checkedCode,
  checkedDocumentReference,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  checkedText,
} from './onboarding-aggregate.js';
import { OnboardingEvents } from './onboarding-events.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import { TASK_TRANSITIONS, isTaskTerminal, type TaskStatus } from './onboarding-vocabulary.js';
import { checkedTaskDefinition, type DefineTask, type TaskState } from './task-definition.js';

export type { TaskState, DefineTask } from './task-definition.js';

/**
 * One unit of work in one onboarding.
 *
 * **Its own aggregate**, not part of the instance, because ten people complete these concurrently on
 * somebody's first week: IT provisions a laptop while HR collects a form while the manager books an
 * induction. Folding tasks into the instance would make the checklist a single row under contention,
 * and the optimistic-concurrency failure would land on whoever clicked second.
 *
 * **A `document` task records a reference, never a file.** This module stores no bytes, and there is
 * no `DocumentPort` adapter behind it in this repository — what is recorded is that a document with
 * a given reference was provided, by a named person, at a known instant.
 *
 * **An `approval` task records a decision made here, today**, with the actor from the authenticated
 * context. It carries `approvalReference`, unused, for Phase 16 to fill when Workflow routes the
 * decision — no table change and no state change at that point (ADR-0049).
 */
export class Task extends OnboardingAggregate {
  private constructor(private task: TaskState) {
    super(task.id, task.tenantId, task.version, 'OnboardingTask');
  }

  public static define(
    request: DefineTask,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<Task> {
    const checked = checkedTaskDefinition(request);

    if (!checked.ok) return checked;

    const task = new Task({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      onboardingId: request.onboardingId,
      ...checked.value,
      // A task with an unfinished predecessor starts blocked, so a screen shows what is actually
      // actionable rather than a list of twelve things three of which cannot be done yet.
      status: request.dependsOnTaskId === undefined ? 'pending' : 'blocked',
      version: 0,
    });

    task.raise(
      OnboardingEvents.taskAssigned,
      {
        taskId: task.id,
        onboardingId: request.onboardingId,
        ownerKind: checked.value.ownerKind,
        ...(checked.value.ownerRef === undefined ? {} : { ownerRef: checked.value.ownerRef }),
        ...(checked.value.ownerRole === undefined ? {} : { ownerRole: checked.value.ownerRole }),
      },
      origin,
      occurredAt,
    );
    return accept(task);
  }

  public static rehydrate(state: TaskState): Task {
    return new Task(state);
  }

  public get status(): TaskStatus {
    return this.task.status;
  }

  public get onboardingId(): string {
    return this.task.onboardingId;
  }

  public get required(): boolean {
    return this.task.required;
  }

  public get dependsOnTaskId(): string | undefined {
    return this.task.dependsOnTaskId;
  }

  /** Whether this task belongs to the given employment, however its owner was expressed. */
  public isOwnedBy(employmentId: string): boolean {
    return this.task.ownerRef === employmentId && this.task.ownerKind !== 'unit';
  }

  /** Somebody has picked it up. A courtesy state, and the point at which Phase 16 will route. */
  public begin(origin: EventOrigin, occurredAt: Date): OnboardingResult<TaskStatus> {
    return this.moveTo('in_progress', origin, occurredAt);
  }

  /** The predecessor finished, so this is actionable. Idempotent: already-pending is not an error. */
  public unblock(origin: EventOrigin, occurredAt: Date): OnboardingResult<TaskStatus> {
    if (this.task.status !== 'blocked') return accept(this.task.status);
    return this.moveTo('pending', origin, occurredAt);
  }

  /**
   * Done, by a named human at a known instant.
   *
   * A `document` task refuses without a reference and an `approval` task without a decision note:
   * a document task marked done with nothing recorded is a checkbox, and the thing it was meant to
   * evidence is missing exactly when somebody asks for it.
   */
  public complete(
    completion: {
      readonly completedBy: string;
      readonly note?: string;
      readonly documentReference?: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<TaskStatus> {
    if (this.task.status === 'blocked') return refuse('task_blocked_by_predecessor');

    const note = checkedText(completion.note, 'completionNote', NOTE_LIMIT);

    if (!note.ok) return note;

    const documentReference = checkedDocumentReference(completion.documentReference);

    if (!documentReference.ok) return documentReference;
    if (this.task.kind === 'document' && documentReference.value === undefined) {
      return refuse('document_task_needs_a_reference');
    }

    const moved = this.moveTo('done', origin, occurredAt);

    if (!moved.ok) return moved;

    this.task = {
      ...this.task,
      completedAt: occurredAt,
      completedBy: completion.completedBy,
      ...(note.value === undefined ? {} : { completionNote: note.value }),
      ...(documentReference.value === undefined
        ? {}
        : { documentReference: documentReference.value }),
    };
    this.raise(
      OnboardingEvents.taskCompleted,
      { taskId: this.id, onboardingId: this.task.onboardingId, kind: this.task.kind },
      origin,
      occurredAt,
    );
    return accept(this.task.status);
  }

  /**
   * Waived: somebody with the authority decided it does not apply, and said why.
   *
   * A separate act from completing, with a separate permission, because "we did it" and "it did not
   * apply to this person" are different answers — and the second is the one an auditor asks about.
   */
  public waive(
    waiver: { readonly reasonCode: string; readonly waivedBy: string },
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<TaskStatus> {
    const reasonCode = checkedCode(waiver.reasonCode, 'waiverReasonCode');

    if (!reasonCode.ok) return reasonCode;

    const moved = this.moveTo('waived', origin, occurredAt);

    if (!moved.ok) return moved;

    this.task = {
      ...this.task,
      completedAt: occurredAt,
      completedBy: waiver.waivedBy,
      waiverReasonCode: reasonCode.value,
    };
    return accept(this.task.status);
  }

  /** Reassigns the task. A deliberate act, recorded, rather than a silent consequence of a move. */
  public reassign(
    owner: {
      readonly ownerKind: TaskState['ownerKind'];
      readonly ownerRef?: string;
      readonly ownerRole?: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<TaskState> {
    if (isTaskTerminal(this.task.status)) return refuse('task_concluded');

    const ownerRole = checkedOptionalCode(owner.ownerRole, 'ownerRole');

    if (!ownerRole.ok) return ownerRole;
    if (owner.ownerKind === 'role' && ownerRole.value === undefined) {
      return refuse('role_owner_needs_a_role');
    }
    if (
      (owner.ownerKind === 'employment' || owner.ownerKind === 'unit') &&
      owner.ownerRef === undefined
    ) {
      return refuse('owner_reference_required');
    }

    const { ownerRef: _previousRef, ownerRole: _previousRole, ...rest } = this.task;

    this.task = {
      ...rest,
      ownerKind: owner.ownerKind,
      ...(owner.ownerRef === undefined ? {} : { ownerRef: owner.ownerRef }),
      ...(ownerRole.value === undefined ? {} : { ownerRole: ownerRole.value }),
    };
    this.raise(
      OnboardingEvents.taskAssigned,
      { taskId: this.id, onboardingId: this.task.onboardingId, ownerKind: owner.ownerKind },
      origin,
      occurredAt,
    );
    return accept(this.task);
  }

  /** Moves the due date. Audited, because a date that quietly moved is a deadline nobody missed. */
  public reschedule(
    dueOn: string | undefined,
    occurredAt: Date,
  ): OnboardingResult<string | undefined> {
    if (isTaskTerminal(this.task.status)) return refuse('task_concluded');

    const checked = checkedOptionalCivilDate(dueOn, 'dueOn');

    if (!checked.ok) return checked;

    const { dueOn: _previous, ...rest } = this.task;

    this.task = { ...rest, ...(checked.value === undefined ? {} : { dueOn: checked.value }) };
    void occurredAt;
    return accept(checked.value);
  }

  /** The onboarding was cancelled. Everything unfinished goes with it; nothing is deleted. */
  public cancel(origin: EventOrigin, occurredAt: Date): OnboardingResult<TaskStatus> {
    if (isTaskTerminal(this.task.status)) return accept(this.task.status);
    return this.moveTo('cancelled', origin, occurredAt);
  }

  public snapshot(): TaskState {
    return { ...this.task, version: this.version };
  }

  private moveTo(
    next: TaskStatus,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<TaskStatus> {
    const from = this.task.status;

    if (from === next) return refuse('task_already_in_status', { status: next });
    if (!TASK_TRANSITIONS[from].includes(next)) {
      return refuse('task_transition_not_permitted', { from, to: next });
    }

    this.task = { ...this.task, status: next };
    void origin;
    void occurredAt;
    return accept(next);
  }
}

const NOTE_LIMIT = 1024;

/** Tenant metadata on a task, checked the same way as everywhere else in this module. */
export const checkedTaskMetadata = checkedMetadata;
