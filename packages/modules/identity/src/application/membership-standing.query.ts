import { success, type Query, type QueryHandler } from '@work/kernel';

import { isActingMembership } from '../domain/identity-vocabulary.js';
import type { MembershipStandingView } from '../contracts/views.js';

import { notFound } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Whether one membership may act in this tenant — the narrowest question this module answers.
 *
 * **It exists because the alternative was `identity.describe-member`.** That query answers a member's
 * whole page — profile, preferences, portals, employments and delegations — and a consumer needing
 * one predicate would have had to receive all of it. A permission does not narrow a payload, so
 * guarding the wide answer with the right permission would not have made it a narrow answer. This is
 * the same reasoning that produced `identity.primary-employment-for-membership` in Phase 16C, and it
 * arrives at the same shape: one identifier in, at most one small thing out, no list and no page.
 *
 * **It publishes a conclusion, not a status** (D-16D-18, approved 2026-08-19). `isActingMembership`
 * is Identity's definition of a membership that may act, and returning `'suspended'` instead of
 * `false` would invite every caller to re-decide whether suspended counts. The first module to answer
 * that differently would be right by its own reading and wrong by this one, and neither would know.
 * So the rule runs here, once, where it is owned.
 *
 * **Missing and another tenant's are the same answer, deliberately.** `byId` filters `tenant_id`
 * explicitly and row-level security filters it again, so an identifier from a neighbouring tenant
 * finds no row and answers `not_found` — identical to an identifier that names nothing at all. That
 * is not a limitation to work around: a caller who could tell "exists elsewhere" from "does not
 * exist" would have a probe for another tenant's register.
 *
 * **Absent is `not_found` rather than `active: false`**, which is the one place this differs from its
 * Phase 16C sibling. There, absence was a real answer about a real member — "you have no primary
 * employment". Here existence *is* the question's subject, and answering `false` would tell a caller
 * that somebody real cannot act when in fact nobody was named. `describe-member` refuses the same way
 * on the same key.
 *
 * **Infrastructure failure raises.** It is not `not_found` and it is not `active: false`: a database
 * that cannot answer has not said no, and a consumer that treated silence as either would fail open
 * on the one path that must fail closed.
 */
export interface MembershipStanding extends Query {
  readonly queryName: 'identity.membership-standing';
  readonly membershipId: string;
}

export const membershipStandingHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<MembershipStanding, MembershipStandingView> => ({
  queryName: 'identity.membership-standing',
  // The register's own read permission, unchanged and unwidened. A membership's lifecycle is the
  // register's own field, so there is no narrower permission that means this fact and none was added.
  // A cross-module caller reaches it through a bounded service grant (ADR-0043) rather than by
  // holding it — the user keeps only their own module's permission.
  permission: IdentityPermissions.membershipRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        query.membershipId,
      );

      if (membership === undefined) return notFound('membership');

      return success({ active: isActingMembership(membership.status) });
    }),
});
