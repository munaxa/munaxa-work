import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';
import {
  archiveReview,
  assignReviewer,
  completeReview,
  moveAssignment,
  moveReview,
} from '../domain/review.js';
import { currentActor, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { snapshotFor } from './review-snapshot.service.js';
import type { AssignmentStatus, ReviewStatus } from '../domain/performance-vocabulary.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * The review: reviewers invited, the lifecycle moved, and completion — which freezes it.
 *
 * **360° is a set of reviewer roles rather than a parallel system** (D-2). Inviting a peer, a direct
 * report or a skip-level manager is one command with a role on it, and the response is an
 * assessment like any other. Nothing here is anonymous: an invitation records who was asked, by
 * name, and a response records who wrote it. A template's minimum withholds an *aggregate* and
 * changes nothing about the rows behind it.
 *
 * **Completion is the point of no return, and it is guarded three times.** The aggregate refuses a
 * second one; the optimistic version refuses the loser of a race; the database trigger refuses any
 * later change from any path including SQL nobody wrote in TypeScript. Two managers completing the
 * same review at the same moment therefore produce exactly one success and one deterministic
 * refusal — no unique index is involved, because a partial index on "the completed state" would be
 * vacuous: one row cannot collide with itself.
 *
 * **Completion also takes the snapshot**, in the same transaction. A completed review with no
 * snapshot is a rating that stops being explainable the moment somebody reorganizes a department,
 * so the two are not separable operations.
 */

export interface AssignReviewerCommand extends Command {
  readonly commandName: 'performance.assign-reviewer';
  readonly reviewId: string;
  readonly reviewerEmploymentId: string;
  readonly role: string;
}

export interface ReviewerAssigned {
  readonly reviewerAssignmentId: string;
}

export const assignReviewerHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<AssignReviewerCommand, ReviewerAssigned> => ({
  commandName: 'performance.assign-reviewer',
  permission: PerformancePermissions.reviewerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const review = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (review === undefined) return notFound<ReviewerAssigned>('performance_review');

      const facts = await dependencies.employment.factsFor(
        command.reviewerEmploymentId,
        dependencies.clock.now(),
      );

      if (facts === undefined || !facts.active) {
        return refuseWith<ReviewerAssigned>('reviewer-employment-unknown');
      }

      const held = await dependencies.stores.reviewers.forReview(transaction, command.reviewId);

      if (
        held.some(
          (assignment) =>
            assignment.reviewerEmploymentId === command.reviewerEmploymentId &&
            assignment.role === command.role,
        )
      ) {
        return refuseWith<ReviewerAssigned>('reviewer-already-assigned');
      }

      const assigned = assignReviewer(review, uuidV7(), {
        ...command,
        requestedAt: dependencies.clock.now(),
        requestedBy: currentActor(),
      });

      if (!assigned.ok) return refusedBy<ReviewerAssigned>(assigned.error);

      await dependencies.stores.reviewers.insert(transaction, assigned.value);
      await dependencies.notifications.intend({
        // Recorded, not delivered. `RecordingNotificationPort` is what production has, and no screen
        // built later may imply anybody was told (D-21).
        templateKey: 'performance.reviewer.invited',
        recipients: [command.reviewerEmploymentId],
        variables: { reviewId: command.reviewId, role: command.role },
      });
      return success({ reviewerAssignmentId: assigned.value.reviewerAssignmentId });
    }),
});

export interface RespondToAssignmentCommand extends Command {
  readonly commandName: 'performance.respond-to-assignment';
  readonly reviewerAssignmentId: string;
  readonly expectedVersion: number;
  readonly status: AssignmentStatus;
  readonly declineReason?: string;
}

export const respondToAssignmentHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RespondToAssignmentCommand, ReviewerAssigned> => ({
  commandName: 'performance.respond-to-assignment',
  permission: PerformancePermissions.assessPeer,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.reviewers.byId(
        transaction,
        command.reviewerAssignmentId,
      );

      if (held === undefined) return notFound<ReviewerAssigned>('performance_reviewer_assignment');

      const moved = moveAssignment(
        held,
        command.status,
        dependencies.clock.now(),
        command.declineReason,
      );

      if (!moved.ok) return refusedBy<ReviewerAssigned>(moved.error);

      await dependencies.stores.reviewers.update(
        transaction,
        { ...moved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ reviewerAssignmentId: held.reviewerAssignmentId });
    }),
});

export interface MoveReviewCommand extends Command {
  readonly commandName: 'performance.move-review';
  readonly reviewId: string;
  readonly expectedVersion: number;
  readonly status: ReviewStatus;
}

export interface ReviewIdentified {
  readonly reviewId: string;
}

export const moveReviewHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<MoveReviewCommand, ReviewIdentified> => ({
  commandName: 'performance.move-review',
  permission: PerformancePermissions.assess,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (held === undefined) return notFound<ReviewIdentified>('performance_review');
      // Completion and archival carry an actor and a snapshot. Routing either through the generic
      // move would produce a completed review with nobody's name on it and nothing to explain it.
      if (command.status === 'completed' || command.status === 'archived') {
        return refuseWith<ReviewIdentified>('review-use-specific-command');
      }

      const moved = moveReview(held, command.status);

      if (!moved.ok) return refusedBy<ReviewIdentified>(moved.error);

      await dependencies.stores.reviews.update(
        transaction,
        { ...moved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ reviewId: held.reviewId });
    }),
});

export interface CompleteReviewCommand extends Command {
  readonly commandName: 'performance.complete-review';
  readonly reviewId: string;
  readonly expectedVersion: number;
}

export const completeReviewHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<CompleteReviewCommand, ReviewIdentified> => ({
  commandName: 'performance.complete-review',
  permission: PerformancePermissions.complete,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (held === undefined) return notFound<ReviewIdentified>('performance_review');

      const cycle = await dependencies.stores.cycles.byId(transaction, held.cycleId);
      const template =
        cycle === undefined
          ? undefined
          : await dependencies.stores.templates.byId(transaction, cycle.reviewTemplateId);

      if (template === undefined) return notFound<ReviewIdentified>('performance_review_template');

      const completed = completeReview(held, {
        completedBy: currentActor(),
        completedAt: dependencies.clock.now(),
        calibrationRequired: template.requiresCalibration,
      });

      if (!completed.ok) return refusedBy<ReviewIdentified>(completed.error);

      const snapshot = await snapshotFor(dependencies, transaction, completed.value, template);

      if (typeof snapshot === 'string') return refuseWith<ReviewIdentified>(snapshot);

      // **The version-guarded update goes first.** The optimistic version is the guard the plan
      // names, and the loser of a completion race must meet *it* — an earlier ordering inserted the
      // snapshot first, so the loser met the snapshot's unique index instead and failed with a
      // constraint violation naming a table nobody asked about. Same outcome, unreadable reason.
      await dependencies.stores.reviews.update(
        transaction,
        { ...completed.value, version: held.version },
        command.expectedVersion,
      );
      await dependencies.stores.snapshots.insert(transaction, snapshot);
      return success({ reviewId: held.reviewId });
    }),
});

export interface ArchiveReviewCommand extends Command {
  readonly commandName: 'performance.archive-review';
  readonly reviewId: string;
  readonly expectedVersion: number;
}

export const archiveReviewHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<ArchiveReviewCommand, ReviewIdentified> => ({
  commandName: 'performance.archive-review',
  permission: PerformancePermissions.complete,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (held === undefined) return notFound<ReviewIdentified>('performance_review');

      const archived = archiveReview(held, dependencies.clock.now());

      if (!archived.ok) return refusedBy<ReviewIdentified>(archived.error);

      await dependencies.stores.reviews.update(
        transaction,
        { ...archived.value, version: held.version },
        command.expectedVersion,
      );
      return success({ reviewId: held.reviewId });
    }),
});
