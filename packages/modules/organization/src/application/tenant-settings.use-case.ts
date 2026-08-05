import { success, type Command, type CommandHandler } from '@work/kernel';

import { TenantSettings } from '../domain/tenant-settings.js';

import { currentTenant, originOfCurrentRequest, refusedBy } from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Configuring one tenant's own defaults — the language its people meet first, the calendar its
 * dates are entered in, its time zone, its numerals, and how long an invitation stays open.
 *
 * This is the command that closes the debt Phase 2 opened. Before it, `ConfiguredTenantSettings`
 * resolved every tenant to the deployment's environment variables, so a hosting arrangement
 * containing a Riyadh customer and an Amman customer had to pick one calendar for both.
 *
 * There is one command rather than a field-by-field set of them, because these settings are what
 * a settings screen submits as a whole and a half-applied set is a tenant in a state nobody
 * chose. First submission creates; every later one replaces.
 */

export interface ConfigureTenantSettingsCommand extends Command {
  readonly commandName: 'organization.configure-tenant-settings';
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly numerals: string;
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly string[];
  /** Absent on the first submission — there is nothing yet to have a version. */
  readonly expectedVersion?: number;
}

export interface TenantSettingsConfigured {
  readonly settingsId: string;
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
}

export const configureTenantSettingsHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<ConfigureTenantSettingsCommand, TenantSettingsConfigured> => ({
  commandName: 'organization.configure-tenant-settings',
  permission: OrganizationPermissions.tenantSettingsManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const tenantId = currentTenant();
      const request = {
        tenantId,
        language: command.language,
        calendar: command.calendar,
        timeZone: command.timeZone,
        numerals: command.numerals,
        invitationValidityDays: command.invitationValidityDays,
        defaultPortals: command.defaultPortals,
      };
      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const existing = await dependencies.stores.tenantSettings.forTenant(transaction, tenantId);

      if (existing === undefined) {
        const configured = TenantSettings.configure(request, origin, now);

        if (!configured.ok) return refusedBy(configured.error);

        await dependencies.stores.tenantSettings.insert(transaction, configured.value.snapshot());
        transaction.collect(configured.value.pullEvents());
        return success(described(configured.value.snapshot()));
      }

      const settings = TenantSettings.rehydrate(existing);
      const reconfigured = settings.reconfigure(request, origin, now);

      if (!reconfigured.ok) return refusedBy(reconfigured.error);

      await dependencies.stores.tenantSettings.update(
        transaction,
        settings.snapshot(),
        command.expectedVersion ?? existing.version,
      );
      transaction.collect(settings.pullEvents());
      return success(described(settings.snapshot()));
    }),
});

const described = (state: {
  readonly id: string;
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
}): TenantSettingsConfigured => ({
  settingsId: state.id,
  language: state.language,
  calendar: state.calendar,
  timeZone: state.timeZone,
});
