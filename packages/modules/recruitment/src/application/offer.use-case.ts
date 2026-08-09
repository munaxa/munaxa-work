import { success, type Command, type CommandHandler } from '@work/kernel';

import { Offer } from '../domain/offer.js';
import type { OfferStatus } from '../domain/recruitment-vocabulary.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { allocateNumber } from './recruitment-numbering.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Offers: drafting them, and deciding them internally before anybody sees them.
 *
 * **A new offer is a new version, never an edit** (A-5). Renegotiating produces version 2 with
 * version 1 intact, so "what did we actually offer, and what did they accept" stays answerable in a
 * dispute years later. The compensation travels through this module as authored and is never
 * computed with: no salary structure, no payroll arithmetic, no statutory deduction.
 *
 * **Approval is a real decision by a named human** (ADR-0045). It is a distinct permission from
 * managing offers, and the decider is taken from the authenticated context rather than from the
 * command — an approval a caller can attribute to somebody else is not evidence of anything.
 */

export interface DraftOfferCommand extends Command {
  readonly commandName: 'recruitment.draft-offer';
  readonly applicationId: string;
  readonly proposedStartDate: string;
  readonly expiresOn?: string;
  readonly proposedPositionId?: string;
  readonly proposedUnitId?: string;
  readonly proposedEmploymentTypeCode?: string;
  /** Stored as authored and never interpreted. No rule in this module reads a key. */
  readonly proposedCompensation?: Metadata;
  readonly currencyCode?: string;
  readonly documentReference?: string;
  readonly metadata?: Metadata;
}

export interface OfferDrafted {
  readonly offerId: string;
  readonly offerNumber: string;
  readonly offerVersion: number;
}

export const draftOfferHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<DraftOfferCommand, OfferDrafted> => ({
  commandName: 'recruitment.draft-offer',
  permission: RecruitmentPermissions.offerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const application = await dependencies.stores.applications.byId(
        transaction,
        command.applicationId,
      );

      if (application === undefined) return notFound<OfferDrafted>('application');
      // An offer to somebody already hired, rejected or gone is an offer nobody can act on.
      if (
        application.status === 'hired' ||
        application.status === 'rejected' ||
        application.status === 'withdrawn'
      ) {
        return conflicted('application_closed');
      }

      const existing = await dependencies.stores.offers.forApplication(
        transaction,
        command.applicationId,
      );
      const now = dependencies.clock.now();
      const offer = Offer.draft(
        {
          tenantId: currentTenant(),
          offerNumber: await allocateNumber(transaction, dependencies, 'offer', 'OFR', now),
          offerVersion: nextVersion(existing),
          ...command,
        },
        originOfCurrentRequest(),
        now,
      );

      if (!offer.ok) return refusedBy(offer.error);

      await dependencies.stores.offers.insert(transaction, offer.value.snapshot());
      transaction.collect(offer.value.pullEvents());
      return success({
        offerId: offer.value.id,
        offerNumber: offer.value.snapshot().offerNumber,
        offerVersion: offer.value.offerVersion,
      });
    }),
});

/** Versions count from one and never reuse: a superseded version stays readable at its number. */
const nextVersion = (existing: readonly { readonly offerVersion: number }[]): number =>
  existing.reduce((highest, offer) => Math.max(highest, offer.offerVersion), 0) + 1;

export interface OfferAffected {
  readonly offerId: string;
  readonly status: OfferStatus;
}

export interface SubmitOfferCommand extends Command {
  readonly commandName: 'recruitment.submit-offer';
  readonly offerId: string;
  readonly expectedVersion: number;
}

export const submitOfferHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<SubmitOfferCommand, OfferAffected> => ({
  commandName: 'recruitment.submit-offer',
  permission: RecruitmentPermissions.offerManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.offers.byId(transaction, command.offerId);

      if (state === undefined) return notFound<OfferAffected>('offer');

      const offer = Offer.rehydrate(state);
      const submitted = offer.submit(originOfCurrentRequest(), dependencies.clock.now());

      if (!submitted.ok) return refusedBy(submitted.error);

      await dependencies.stores.offers.update(
        transaction,
        offer.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(offer.pullEvents());
      return success({ offerId: offer.id, status: offer.status });
    }),
});

export interface DecideOfferCommand extends Command {
  readonly commandName: 'recruitment.decide-offer';
  readonly offerId: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * The internal decision on an offer, taken by somebody who may commit the terms.
 *
 * `recruitment.offer.approve`, deliberately separate from `recruitment.offer.manage`: the recruiter
 * who drafted the terms is not automatically the person who may approve them.
 */
export const decideOfferHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<DecideOfferCommand, OfferAffected> => ({
  commandName: 'recruitment.decide-offer',
  permission: RecruitmentPermissions.offerApprove,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.offers.byId(transaction, command.offerId);

      if (state === undefined) return notFound<OfferAffected>('offer');

      const offer = Offer.rehydrate(state);
      const decided = offer.decide(
        command.decision,
        currentActor(),
        command.note,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!decided.ok) return refusedBy(decided.error);

      await dependencies.stores.offers.update(
        transaction,
        offer.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(offer.pullEvents());
      return success({ offerId: offer.id, status: offer.status });
    }),
});
