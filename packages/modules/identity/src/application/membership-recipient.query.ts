import { success, type Query, type QueryHandler } from '@work/kernel';

import type { MembershipRecipientView } from '../contracts/views.js';

import { notFound } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Which workforce user a membership belongs to — the second narrowest question this module answers.
 *
 * **Why a module that already publishes this field needs another query for it.** Three queries
 * return `TenantMembershipView`, which carries `workforceUserId`, and not one of them can be used
 * here: `list-memberships` and `active-memberships-for-employment` are *lists*, and
 * `describe-member` answers a member's whole page. A consumer that wants to address one person
 * would have had to enumerate a register or read a profile to learn a single identifier. So this is
 * the same shape `identity.membership-standing` took, for the same reason and by the same argument
 * (D-16D-18): one identifier in, at most one small thing out, no list and no page.
 *
 * **It exists to be a notification recipient and says so.** Workflow addresses *memberships* — an
 * approval is asked of a member — while every notification is delivered to a *workforce user*,
 * because a person with memberships in three tenants is one person with one set of channel
 * preferences (ADR-0033). Somebody has to cross that boundary, and the module that owns the mapping
 * is the one that should: a consumer joining the two itself would be a second place the rule lived.
 *
 * **It carries the identity and nothing else.** No name, no email address, no locale, no channel
 * preference, no profile, no employment, no reporting line, no delegation, no portal. Communications
 * resolves how to reach somebody from the user; this answers only *who*. A field added here later
 * would be a field every consumer receives whether or not it needed it, which is exactly the
 * property that ruled out `describe-member`.
 *
 * **The membership's standing is deliberately not answered here.** Whether a member may *act* is
 * `identity.membership-standing`, and folding the two into one reply would make a caller that wanted
 * an address take a position on eligibility. A reminder is sent to whoever the step names; that they
 * may still act is a different question, asked by whoever needs it.
 *
 * **Missing and another tenant's are the same answer.** `byId` filters `tenant_id` explicitly and
 * row-level security filters it again, so an identifier from a neighbouring tenant finds no row and
 * answers `not_found` — identical to one that names nothing. A caller able to tell those apart would
 * hold a probe for another tenant's register.
 *
 * **Infrastructure failure raises**, and is neither `not_found` nor a recipient. A database that
 * cannot answer has not said "nobody", and a caller treating silence as either would either send
 * nothing or send somewhere wrong.
 */
export interface MembershipRecipient extends Query {
  readonly queryName: 'identity.membership-recipient';
  readonly membershipId: string;
}

export const membershipRecipientHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<MembershipRecipient, MembershipRecipientView> => ({
  queryName: 'identity.membership-recipient',
  // The register's own read permission, unchanged and unwidened — the same one
  // `identity.membership-standing` declares. Which user a membership belongs to is the register's
  // own field, so there is no narrower permission that means this fact and none was added. A
  // cross-module caller reaches it through a bounded service grant (ADR-0043) rather than by holding
  // it, so the user keeps only their own module's permission.
  permission: IdentityPermissions.membershipRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        query.membershipId,
      );

      if (membership === undefined) return notFound('membership');

      return success({ workforceUserId: membership.workforceUserId });
    }),
});
