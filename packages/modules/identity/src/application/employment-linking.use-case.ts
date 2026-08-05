import {
  isUuidV7,
  success,
  type Command,
  type CommandHandler,
  type EventOrigin,
  type Transaction,
} from '@work/kernel';

import { EmploymentLink } from '../domain/employment-link.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Attaching a job to a person, detaching it, and deciding which of several is the main one.
 *
 * The employment itself belongs to Phase 5 and is referenced by identifier only. This module
 * never asks what the job is, and it never deletes a person because a job ended (AD-008).
 */

export interface LinkEmployment extends Command {
  readonly commandName: 'identity.link-employment';
  readonly membershipId: string;
  readonly employmentId: string;
  readonly isPrimary: boolean;
}

export interface EmploymentLinkChanged {
  readonly linkId: string;
  readonly isPrimary: boolean;
  readonly status: string;
}

export const linkEmploymentHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<LinkEmployment, EmploymentLinkChanged> => ({
  commandName: 'identity.link-employment',
  permission: IdentityPermissions.employmentLinkManage,

  validate: (command) =>
    isUuidV7(command.employmentId)
      ? []
      : [{ field: 'employmentId', message: 'must be an employment identifier' }],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        command.membershipId,
      );

      if (membership === undefined) return notFound('membership');

      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();

      // "Exactly one primary" is an invariant across links, so the incumbent is demoted in the
      // same transaction. Doing it afterwards would leave a window with two primaries, and a
      // payroll grouping run in that window would produce a wrong answer nobody could reproduce.
      if (command.isPrimary) {
        await demoteIncumbent(dependencies, transaction, command.membershipId, origin, now);
      }

      const link = EmploymentLink.link(
        {
          tenantId: currentTenant(),
          membershipId: command.membershipId,
          employmentId: command.employmentId,
          isPrimary: command.isPrimary,
        },
        origin,
        now,
      );

      await dependencies.stores.employmentLinks.insert(transaction, link.snapshot());
      transaction.collect(link.pullEvents());

      return success({ linkId: link.id, isPrimary: link.isPrimary, status: link.currentStatus });
    }),
});

export interface UnlinkEmployment extends Command {
  readonly commandName: 'identity.unlink-employment';
  readonly linkId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

export const unlinkEmploymentHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<UnlinkEmployment, EmploymentLinkChanged> => ({
  commandName: 'identity.unlink-employment',
  permission: IdentityPermissions.employmentLinkManage,

  validate: (command) =>
    command.reason.trim() === '' ? [{ field: 'reason', message: 'must state why' }] : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.employmentLinks.byId(transaction, command.linkId);

      if (existing === undefined) return notFound('employment link');

      const link = EmploymentLink.rehydrate(existing);
      const outcome = link.unlink(
        command.reason,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.employmentLinks.update(
        transaction,
        link.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(link.pullEvents());

      return success({ linkId: link.id, isPrimary: link.isPrimary, status: link.currentStatus });
    }),
});

export interface MakeEmploymentPrimary extends Command {
  readonly commandName: 'identity.make-employment-primary';
  readonly linkId: string;
  readonly expectedVersion: number;
}

export const makeEmploymentPrimaryHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<MakeEmploymentPrimary, EmploymentLinkChanged> => ({
  commandName: 'identity.make-employment-primary',
  permission: IdentityPermissions.employmentLinkManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.employmentLinks.byId(transaction, command.linkId);

      if (existing === undefined) return notFound('employment link');

      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();

      await demoteIncumbent(dependencies, transaction, existing.membershipId, origin, now);

      const link = EmploymentLink.rehydrate(existing);
      const outcome = link.makePrimary(origin, now);

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.employmentLinks.update(
        transaction,
        link.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(link.pullEvents());

      return success({ linkId: link.id, isPrimary: link.isPrimary, status: link.currentStatus });
    }),
});

/** Steps the current primary down, if there is one, so the partial unique index stays satisfiable. */
const demoteIncumbent = async (
  dependencies: IdentityDependencies,
  transaction: Transaction,
  membershipId: string,
  origin: EventOrigin,
  now: Date,
): Promise<void> => {
  const incumbent = await dependencies.stores.employmentLinks.primaryFor(transaction, membershipId);

  if (incumbent === undefined) return;

  const link = EmploymentLink.rehydrate(incumbent);

  link.relinquishPrimary(origin, now);
  await dependencies.stores.employmentLinks.update(transaction, link.snapshot(), incumbent.version);
  transaction.collect(link.pullEvents());
};
