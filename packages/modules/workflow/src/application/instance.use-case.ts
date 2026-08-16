import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { cancelInstance, startInstance, type StartedInstance } from '../domain/instance.js';
import { plannedStepCount } from '../domain/branch-plan.js';
import { cancellationHistory, startHistory } from '../domain/history.js';
import { snapshotGroups, snapshotManager } from './instance-snapshot.js';
import {
  currentActor,
  currentCorrelation,
  currentMembership,
  notFound,
  refuseWith,
  refusedBy,
} from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Raising an approval, and stopping one.
 *
 * **Starting is one operation and several writes**: the instance, a step per template, and the two
 * history entries that say it was raised and who was asked first. They are issued inside a single
 * `unitOfWork.execute`, so Checkpoint 5's repositories inherit one transaction and either all of
 * them exist or none does. An instance with no steps could never complete, and a step with no
 * instance is a queue entry for an approval nobody raised.
 *
 * **The requester is the caller's membership, never a command field.** A caller who could name the
 * requester could raise an approval in somebody else's name — and the requester is what the
 * `instance-started` history entry records. Since Phase 16C it is also *whose manager* a `manager`
 * step means, which makes the absence of that field an authorization control twice over.
 *
 * **Everything a running approval depends on is read here and never again.** The group memberships,
 * the requester's manager, and the instant every opening step's clock starts. Each is copied onto the
 * steps, so editing a group, reorganizing a reporting line or correcting a target afterwards changes
 * nothing about an approval already under way (AD-003). A manager that cannot be resolved fails the
 * **whole** start — no instance, no steps, no history — because the writes are one `execute` and a
 * refusal from the domain returns before any of them.
 *
 * **A duplicate submission converges rather than erroring.** `workflow_instance_open_subject_idx`
 * permits one running approval per subject, which is the specification's "Duplicate Approval
 * Requests" validation. A retried request finds the open one and returns its identifier with
 * `created: false`, because a retry that reported a conflict would make a lost response
 * indistinguishable from a duplicate act — the shape Career used for a re-issued nomination.
 *
 * **Cancelling is not rejecting.** The adopting module learns that nobody decided rather than that
 * somebody refused, and the two have different consequences for what it does next.
 */

export interface StartInstanceCommand extends Command {
  readonly commandName: 'workflow.start-instance';
  readonly definitionId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** The requesting module's own facts. Stored for audit; nothing in Phase 16A reads it (D-7). */
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface InstanceStarted {
  /** The approval identifier — the value `ApprovalPort` returns and an adopting module stores. */
  readonly instanceId: string;
  /** `false` where a running approval for this subject already existed. Convergence, not an error. */
  readonly created: boolean;
}

export const startInstanceHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<StartInstanceCommand, InstanceStarted> => ({
  commandName: 'workflow.start-instance',
  permission: WorkflowPermissions.instanceStart,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const requester = currentMembership();

      if (requester === undefined) return refuseWith('membership-unresolved');

      const open = await dependencies.stores.instances.openForSubject(
        transaction,
        command.subjectType,
        command.subjectId,
      );

      if (open !== undefined) return success({ instanceId: open.instanceId, created: false });

      const definition = await dependencies.stores.definitions.byId(
        transaction,
        command.definitionId,
      );

      if (definition === undefined) return notFound('workflow-definition');
      if (definition.subjectType !== command.subjectType) {
        return refuseWith('subject-type-not-this-definition');
      }

      const version = await dependencies.stores.versions.currentPublished(
        transaction,
        command.definitionId,
      );

      if (version === undefined) return refuseWith('definition-has-no-published-version');

      const templates = await dependencies.stores.versions.templatesFor(
        transaction,
        version.workflowVersionId,
      );
      const groups = await snapshotGroups(dependencies, transaction, templates);
      // One instant for the whole start: the approval's `startedAt`, the day the reporting line is
      // read at, and the clock every opening step begins from are the same moment, read once.
      const at = dependencies.clock.now();
      const manager = await snapshotManager(dependencies, templates, requester, at);
      const started = startInstance(version, templates, {
        instanceId: uuidV7(),
        subjectType: command.subjectType,
        subjectId: command.subjectId,
        requestedByMembershipId: requester,
        correlationId: currentCorrelation(),
        context: command.context ?? {},
        at,
        // One identifier per **planned** step, not per template: a group of four expands to four
        // steps, and the count is the plan's rather than the configuration's.
        stepIds: Array.from({ length: plannedStepCount(templates, groups, manager) }, () => uuidV7()),
        groups,
        ...(manager === undefined ? {} : { manager }),
      });

      if (!started.ok) return refusedBy(started.error);

      await persistStart(dependencies, transaction, started.value);
      return success({ instanceId: started.value.instance.instanceId, created: true });
    }),
});

/**
 * The writes a start makes.
 *
 * The instance first, because every step and every history entry references it. The steps then, in
 * one pass: 16A wrote the pending ones before the awaiting one because
 * `workflow_step_awaiting_idx` refused a second awaiting row and could not be deferred. That index
 * was widened in Checkpoint 3 — a branch is asked all at once — so the ordering constraint is gone
 * and writing in plan order is now both simpler and honest about what the schema requires.
 *
 * The history identifiers are sized for the entries a start can actually produce: one for the
 * instance, one per step that opened or was skipped, and one more for an instance that completed
 * because every branch was gated out. Surplus identifiers are dropped by `startHistory` rather than
 * turning into entries.
 */
const persistStart = async (
  dependencies: WorkflowDependencies,
  transaction: Transaction,
  started: StartedInstance,
): Promise<void> => {
  await dependencies.stores.instances.insert(transaction, started.instance);

  for (const step of started.steps) {
    await dependencies.stores.steps.insert(transaction, step);
  }
  for (const entry of startHistory(
    started,
    Array.from({ length: started.steps.length + 2 }, () => uuidV7()),
  )) {
    await dependencies.stores.history.insert(transaction, entry);
  }
};

export interface CancelInstanceCommand extends Command {
  readonly commandName: 'workflow.cancel-instance';
  readonly instanceId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

/**
 * Stopping an approval nobody decided.
 *
 * A named human act with its own permission — holding `instance.start` does not open it, because
 * ending somebody else's request mid-flight is not the same act as raising one. Terminal: asking
 * again is a new approval, for the same reason a rejected one is not resubmitted.
 */
export const cancelInstanceHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<CancelInstanceCommand, { readonly cancelled: true }> => ({
  commandName: 'workflow.cancel-instance',
  permission: WorkflowPermissions.instanceCancel,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.instances.byId(transaction, command.instanceId);

      if (held === undefined) return notFound('workflow-instance');

      const steps = await dependencies.stores.steps.forInstance(transaction, command.instanceId);
      const at = dependencies.clock.now();
      const cancelled = cancelInstance(held, steps, {
        by: currentActor(),
        reason: command.reason,
        at,
      });

      if (!cancelled.ok) return refusedBy(cancelled.error);

      // Steps out of `awaiting` before the instance, so no intermediate state has a terminal
      // approval with a step still waiting on somebody's queue.
      for (const step of cancelled.value.skipped) {
        await dependencies.stores.steps.update(transaction, step, step.version);
      }
      await dependencies.stores.instances.update(
        transaction,
        cancelled.value.instance,
        command.expectedVersion,
      );
      // The membership, not the audit actor: the timeline's actor column is a membership, and the
      // instance's `cancelled_by` is the authenticated request's actor. Two identities, two columns.
      for (const entry of cancellationHistory(
        cancelled.value,
        at,
        cancelled.value.skipped.map(() => uuidV7()).concat(uuidV7()),
        currentMembership(),
      )) {
        await dependencies.stores.history.insert(transaction, entry);
      }
      return success({ cancelled: true as const });
    }),
});
