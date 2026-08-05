import { runInContext, type DomainEvent, type EventHandler } from '@work/kernel';

import { Delegation } from '../domain/delegation.js';
import { PortalAssignment } from '../domain/portal-assignment.js';

import { IdentityEvents } from '../domain/identity-events.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * When somebody leaves a tenant, their portals close and the cover they had arranged stops.
 *
 * This is a reaction to an event rather than part of `TenantMembership.end`, and the reason is
 * the consistency boundary: portals and delegations are separate aggregates, and a method that
 * reached across to mutate them would grow a transaction that touches every row a person has,
 * which is how a departure at month-end deadlocks against payroll.
 *
 * It runs after the membership change has committed, so its own failure cannot roll that back —
 * the person has left either way. That is the honest arrangement, and it is why the handler is
 * idempotent: a retry finds the portals already revoked and refuses each one rather than
 * raising a second revocation event.
 */

interface MembershipEndedPayload {
  readonly membershipId: string;
  readonly workforceUserId: string;
  readonly reason: string;
}

const REASON = 'membership ended';

export const onMembershipEnded = (dependencies: IdentityDependencies): EventHandler => ({
  eventName: IdentityEvents.membershipEnded,

  handle: async (event: DomainEvent): Promise<void> => {
    const payload = event.payload as MembershipEndedPayload;

    // The event carries its own tenant and correlation, so the reaction runs in the same context
    // the change did rather than in whatever context happened to dispatch it.
    await runInContext(
      {
        tenantId: event.tenantId,
        correlationId: event.correlationId,
        actor: event.actor,
      },
      async () =>
        dependencies.unitOfWork.execute(async (transaction) => {
          const now = dependencies.clock.now();
          const origin = {
            tenantId: event.tenantId,
            correlationId: event.correlationId,
            actor: event.actor,
            causationId: event.eventId,
          };

          for (const state of await dependencies.stores.portals.forMembership(
            transaction,
            payload.membershipId,
          )) {
            const assignment = PortalAssignment.rehydrate(state);

            if (!assignment.revoke(REASON, origin, now).ok) continue;

            await dependencies.stores.portals.update(
              transaction,
              assignment.snapshot(),
              state.version,
            );
            transaction.collect(assignment.pullEvents());
          }

          for (const state of await dependencies.stores.delegations.forDelegator(
            transaction,
            payload.membershipId,
          )) {
            const delegation = Delegation.rehydrate(state);

            if (!delegation.revoke(REASON, origin, now).ok) continue;

            await dependencies.stores.delegations.update(
              transaction,
              delegation.snapshot(),
              state.version,
            );
            transaction.collect(delegation.pullEvents());
          }
        }),
    );
  },
});
