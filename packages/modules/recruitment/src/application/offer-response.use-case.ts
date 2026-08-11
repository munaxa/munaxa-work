import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { Application } from '../domain/application.js';
import { Offer } from '../domain/offer.js';
import { isOfferLive } from '../domain/recruitment-vocabulary.js';

import { conflicted, notFound, originOfCurrentRequest, refusedBy } from './recruitment-context.js';
import { recordMovement } from './application.use-case.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import type { OfferAffected } from './offer.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Issuing an offer, and recording what the candidate said.
 *
 * **At most one offer is live at a time.** A candidate holding two open offers for one job has two
 * answers to which terms bind, so issuing while another version is issued or accepted is refused
 * here and by a partial unique index — the recruiter withdraws version 1 before sending version 2.
 *
 * **Issuing moves the application to `offered` in the same transaction.** Two writes that must agree
 * and could be separated are two writes that will disagree the first time one of them fails.
 */

export interface IssueOfferCommand extends Command {
  readonly commandName: 'recruitment.issue-offer';
  readonly offerId: string;
  readonly expectedVersion: number;
  readonly expectedApplicationVersion: number;
}

export const issueOfferHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<IssueOfferCommand, OfferAffected> => ({
  commandName: 'recruitment.issue-offer',
  permission: RecruitmentPermissions.offerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.offers.byId(transaction, command.offerId);

      if (state === undefined) return notFound<OfferAffected>('offer');

      const siblings = await dependencies.stores.offers.forApplication(
        transaction,
        state.applicationId,
      );

      if (siblings.some((other) => other.id !== state.id && isOfferLive(other.status))) {
        return conflicted('another_offer_is_live');
      }

      const offer = Offer.rehydrate(state);
      const issued = offer.issue(originOfCurrentRequest(), dependencies.clock.now());

      if (!issued.ok) return refusedBy(issued.error);

      const moved = await moveApplicationToOffered(transaction, dependencies, {
        applicationId: state.applicationId,
        expectedVersion: command.expectedApplicationVersion,
      });

      if (moved !== undefined) return moved;

      await dependencies.stores.offers.update(
        transaction,
        offer.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(offer.pullEvents());
      return success({ offerId: offer.id, status: offer.status });
    }),
});

/**
 * Puts the application in `offered` when an offer goes out.
 *
 * Already-offered is not an error: version 2 of an offer reaches a candidate whose application is
 * already at that stage, and refusing there would make renegotiation impossible.
 */
const moveApplicationToOffered = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  target: { readonly applicationId: string; readonly expectedVersion: number },
): Promise<ReturnType<typeof notFound<OfferAffected>> | undefined> => {
  const state = await dependencies.stores.applications.byId(transaction, target.applicationId);

  if (state === undefined) return notFound<OfferAffected>('application');
  if (state.status === 'offered') return undefined;

  const application = Application.rehydrate(state);
  const moved = application.moveTo(
    'offered',
    undefined,
    originOfCurrentRequest(),
    dependencies.clock.now(),
  );

  if (!moved.ok) return refusedBy<OfferAffected>(moved.error);

  await dependencies.stores.applications.update(
    transaction,
    application.snapshot(),
    target.expectedVersion,
  );
  transaction.collect(application.pullEvents());
  await recordMovement(transaction, dependencies, {
    applicationId: application.id,
    fromStatus: state.status,
    toStatus: 'offered',
  });
  return undefined;
};

export interface RecordOfferResponseCommand extends Command {
  readonly commandName: 'recruitment.record-offer-response';
  readonly offerId: string;
  readonly response: 'accepted' | 'declined';
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * What the candidate answered.
 *
 * Recorded by a recruiter who heard it, because this phase ships no candidate portal — that is
 * scope, stated rather than simulated. An acceptance moves nothing else on its own: the hire is a
 * separate, separately permissioned act (ADR-0046), and a candidate who accepts and then does not
 * start must not already be an employee.
 */
export const recordOfferResponseHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<RecordOfferResponseCommand, OfferAffected> => ({
  commandName: 'recruitment.record-offer-response',
  permission: RecruitmentPermissions.offerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.offers.byId(transaction, command.offerId);

      if (state === undefined) return notFound<OfferAffected>('offer');

      const offer = Offer.rehydrate(state);
      const recorded = offer.recordResponse(
        command.response,
        command.note,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!recorded.ok) return refusedBy(recorded.error);

      await dependencies.stores.offers.update(
        transaction,
        offer.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(offer.pullEvents());
      return success({ offerId: offer.id, status: offer.status });
    }),
});

export interface CloseOfferCommand extends Command {
  readonly commandName: 'recruitment.close-offer';
  readonly offerId: string;
  /** Withdrawn by the employer; expired because nobody answered in time. */
  readonly outcome: 'withdrawn' | 'expired';
  readonly expectedVersion: number;
}

export const closeOfferHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CloseOfferCommand, OfferAffected> => ({
  commandName: 'recruitment.close-offer',
  permission: RecruitmentPermissions.offerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.offers.byId(transaction, command.offerId);

      if (state === undefined) return notFound<OfferAffected>('offer');

      const offer = Offer.rehydrate(state);
      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const closed =
        command.outcome === 'expired' ? offer.expire(origin, now) : offer.withdraw(origin, now);

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.offers.update(
        transaction,
        offer.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(offer.pullEvents());
      return success({ offerId: offer.id, status: offer.status });
    }),
});
