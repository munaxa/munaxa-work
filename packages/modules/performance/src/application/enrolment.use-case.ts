import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';
import { enrolReview } from '../domain/review.js';
import { notFound, refuseWith } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Enrolling participants: one review per employment, idempotent, and bounded.
 *
 * **Every employment is confirmed through Employment's published contract** — existence, activity
 * and the manager at the moment of enrolment. An employment that cannot be confirmed is *named in
 * the result* rather than silently dropped: a cycle that quietly enrolled 1,847 of 1,850 people is
 * a cycle where three people never got a review and nobody found out until they asked.
 *
 * Re-running it is safe, which is what makes recovery from a partial enrolment a matter of running
 * the command again.
 */

const MAX_ENROLMENT = 1000;

export interface EnrolParticipantsCommand extends Command {
  readonly commandName: 'performance.enrol-participants';
  readonly cycleId: string;
  /** Explicit employments, or a unit to enrol from. One or the other, never both. */
  readonly employmentIds?: readonly string[];
  readonly organizationUnitId?: string;
}

export interface ParticipantsEnrolled {
  readonly enrolled: number;
  readonly skipped: number;
  /** Employments Employment could not confirm. Named, not silently dropped. */
  readonly refused: readonly string[];
}

/**
 * Enrolling participants: one review per employment, idempotent, and bounded.
 *
 * **Every employment is confirmed through Employment's published contract** — existence, activity
 * and the manager at the moment of enrolment. An employment that cannot be confirmed is *named in
 * the result* rather than silently dropped: a cycle that quietly enrolled 1,847 of 1,850 people is
 * a cycle where three people never got a review and nobody found out until they asked.
 *
 * Re-running it is safe. An employment already enrolled is counted as skipped, which is what makes
 * recovery from a partial enrolment a matter of running the command again.
 */
export const enrolParticipantsHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<EnrolParticipantsCommand, ParticipantsEnrolled> => ({
  commandName: 'performance.enrol-participants',
  permission: PerformancePermissions.cycleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const cycle = await dependencies.stores.cycles.byId(transaction, command.cycleId);

      if (cycle === undefined) return notFound<ParticipantsEnrolled>('performance_cycle');
      if (cycle.status !== 'draft' && cycle.status !== 'open') {
        return refuseWith<ParticipantsEnrolled>('cycle-not-enrolling');
      }
      if ((command.employmentIds === undefined) === (command.organizationUnitId === undefined)) {
        return refuseWith<ParticipantsEnrolled>('enrolment-needs-one-source');
      }

      const template = await dependencies.stores.templates.byId(
        transaction,
        cycle.reviewTemplateId,
      );

      if (template === undefined)
        return notFound<ParticipantsEnrolled>('performance_review_template');

      return success(
        await enrol(dependencies, transaction, command, cycle, template.ratingScaleId),
      );
    }),
});

const enrol = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  command: EnrolParticipantsCommand,
  cycle: { readonly cycleId: string },
  ratingScaleId: string,
): Promise<ParticipantsEnrolled> => {
  const asOf = dependencies.clock.now();
  const candidates =
    command.organizationUnitId === undefined
      ? (command.employmentIds ?? []).slice(0, MAX_ENROLMENT)
      : (await dependencies.employment.inUnit(command.organizationUnitId, asOf, MAX_ENROLMENT)).map(
          (facts) => facts.employmentId,
        );
  const refused: string[] = [];
  let enrolled = 0;
  let skipped = 0;

  for (const employmentId of candidates) {
    const existing = await dependencies.stores.reviews.forParticipant(
      transaction,
      cycle.cycleId,
      employmentId,
    );

    if (existing !== undefined) {
      skipped += 1;
      continue;
    }

    const facts = await dependencies.employment.factsFor(employmentId, asOf);

    if (facts === undefined || !facts.active) {
      refused.push(employmentId);
      continue;
    }

    const review = enrolReview({
      reviewId: uuidV7(),
      cycleId: cycle.cycleId,
      employmentId,
      ratingScaleId,
      ...(facts.managerEmploymentId === undefined
        ? {}
        : { managerEmploymentId: facts.managerEmploymentId }),
    });

    if (!review.ok) {
      refused.push(employmentId);
      continue;
    }

    await dependencies.stores.reviews.insert(transaction, review.value);
    enrolled += 1;
  }

  return { enrolled, skipped, refused };
};
