import type { TenantIdentitySettings, TenantSettingsPort } from './identity-ports.js';

/**
 * The tenant settings the module's own tests run against.
 *
 * A tenant in Riyadh, deliberately: Arabic, Hijri, Arabic-Indic numerals. Testing against
 * English and Gregorian would let a hardcoded English default pass every test in this suite and
 * fail on the first customer.
 */
export class ConfiguredTenantSettingsForTest implements TenantSettingsPort {
  public constructor(
    private readonly settings: TenantIdentitySettings = {
      language: 'ar',
      calendar: 'hijri',
      timeZone: 'Asia/Riyadh',
      numerals: 'arabic-indic',
      invitationValidityDays: 14,
      defaultPortals: ['employee'],
    },
  ) {}

  public settingsFor(): Promise<TenantIdentitySettings> {
    return Promise.resolve(this.settings);
  }
}
