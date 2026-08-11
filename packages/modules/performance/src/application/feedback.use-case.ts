import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { giveFeedback } from '../domain/feedback.js';
import { currentActor, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Continuous feedback: given, and withdrawn — never edited.
 *
 * **`performance.give-feedback`, and the row is `performance_feedback`.** Recruitment already owns
 * interview feedback with its own states and its own meaning; nothing here touches it, and the
 * separate vocabulary is what stops the two being mis-joined by somebody who has read only one of
 * them (D-20).
 *
 * **Withdrawal is a soft delete.** It leaves every word in place, because a record that could be
 * rewritten after the fact is not a record of what was said. Only the author may withdraw their own:
 * feedback somebody else can silently remove is feedback nobody can rely on having given.
 *
 * **There is no anonymous visibility to choose.** The row carries its author's employment, the audit
 * columns carry the actor and row-level security carries the tenant. Offering the word would be a
 * claim this architecture cannot keep (D-12).
 */

export interface GiveFeedbackCommand extends Command {
  readonly commandName: 'performance.give-feedback';
  readonly subjectEmploymentId: string;
  /** The author's employment. Checked against the subject; a self-note is refused. */
  readonly authorEmploymentId: string;
  readonly kind: string;
  readonly visibility: string;
  readonly body: string;
  readonly relatedGoalId?: string;
  readonly relatedReviewId?: string;
}

export interface FeedbackIdentified {
  readonly feedbackId: string;
}

export const giveFeedbackHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<GiveFeedbackCommand, FeedbackIdentified> => ({
  commandName: 'performance.give-feedback',
  permission: PerformancePermissions.feedbackGive,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = dependencies.clock.now();
      const subject = await dependencies.employment.factsFor(command.subjectEmploymentId, asOf);

      if (subject === undefined) return refuseWith<FeedbackIdentified>('feedback-subject-unknown');

      const author = await dependencies.employment.factsFor(command.authorEmploymentId, asOf);

      if (author === undefined) return refuseWith<FeedbackIdentified>('feedback-author-unknown');

      const given = giveFeedback({
        feedbackId: uuidV7(),
        ...command,
        givenAt: asOf,
        requestedBy: currentActor(),
      });

      if (!given.ok) return refusedBy<FeedbackIdentified>(given.error);

      await dependencies.stores.feedback.insert(transaction, given.value);
      return success({ feedbackId: given.value.feedbackId });
    }),
});

export interface WithdrawFeedbackCommand extends Command {
  readonly commandName: 'performance.withdraw-feedback';
  readonly feedbackId: string;
  readonly authorEmploymentId: string;
}

export const withdrawFeedbackHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<WithdrawFeedbackCommand, FeedbackIdentified> => ({
  commandName: 'performance.withdraw-feedback',
  permission: PerformancePermissions.feedbackGive,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.feedback.byId(transaction, command.feedbackId);

      if (held === undefined) return notFound<FeedbackIdentified>('performance_feedback');
      if (held.authorEmploymentId !== command.authorEmploymentId) {
        // Not `forbidden`: the caller already holds the identifier, and naming the author would
        // tell them who wrote a piece of feedback they may not be entitled to attribute.
        return notFound<FeedbackIdentified>('performance_feedback');
      }

      await dependencies.stores.feedback.withdraw(
        transaction,
        command.feedbackId,
        dependencies.clock.now(),
        currentActor(),
      );
      return success({ feedbackId: command.feedbackId });
    }),
});
