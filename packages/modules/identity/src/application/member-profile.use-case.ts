import { success, type Command, type CommandHandler } from '@work/kernel';

import { BusinessProfile, type BusinessProfileChange } from '../domain/business-profile.js';
import { UserPreference, type PreferenceChange } from '../domain/user-preference.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * How a tenant records a member's business-facing details, and how a member records how they
 * want the product rendered.
 *
 * Two separate permissions, because they are two different acts: an HR administrator maintains
 * the org chart, and an individual chooses their own language and calendar. A product that
 * required an administrator for the second would be a product where an Arabic-speaking employee
 * raises a ticket to read their payslip.
 */

export interface ReviseProfile extends Command {
  readonly commandName: 'identity.revise-profile';
  readonly membershipId: string;
  readonly change: BusinessProfileChange;
  /** Absent when the profile is being created for the first time. */
  readonly expectedVersion?: number;
}

export interface ProfileRevised {
  readonly profileId: string;
  readonly membershipId: string;
}

export const reviseProfileHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<ReviseProfile, ProfileRevised> => ({
  commandName: 'identity.revise-profile',
  permission: IdentityPermissions.profileManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        command.membershipId,
      );

      if (membership === undefined) return notFound('membership');

      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const existing = await dependencies.stores.profiles.forMembership(
        transaction,
        command.membershipId,
      );

      if (existing === undefined) {
        const created = BusinessProfile.create(
          {
            tenantId: currentTenant(),
            membershipId: command.membershipId,
            change: command.change,
          },
          origin,
          now,
        );

        if (!created.ok) return refusedBy(created.error);

        await dependencies.stores.profiles.insert(transaction, created.value.snapshot());
        transaction.collect(created.value.pullEvents());
        return success({ profileId: created.value.id, membershipId: command.membershipId });
      }

      const profile = BusinessProfile.rehydrate(existing);
      const revised = profile.revise(command.change, origin, now);

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.profiles.update(
        transaction,
        profile.snapshot(),
        command.expectedVersion ?? existing.version,
      );
      transaction.collect(profile.pullEvents());

      return success({ profileId: profile.id, membershipId: command.membershipId });
    }),
});

export interface RevisePreference extends Command {
  readonly commandName: 'identity.revise-preference';
  readonly membershipId: string;
  readonly change: PreferenceChange;
  readonly expectedVersion: number;
}

export interface PreferenceRevised {
  readonly preferenceId: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

export const revisePreferenceHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<RevisePreference, PreferenceRevised> => ({
  commandName: 'identity.revise-preference',
  permission: IdentityPermissions.preferenceManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.preferences.forMembership(
        transaction,
        command.membershipId,
      );

      // Preferences are seeded from the tenant's defaults when somebody joins, so their absence
      // means the membership does not exist rather than that nobody has chosen a language.
      if (existing === undefined) return notFound('preferences');

      const preference = UserPreference.rehydrate(existing);
      const revised = preference.revise(
        command.change,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.preferences.update(
        transaction,
        preference.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(preference.pullEvents());

      return success({
        preferenceId: preference.id,
        language: preference.language,
        direction: preference.direction,
      });
    }),
});
