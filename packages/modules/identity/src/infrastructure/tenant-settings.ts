import type { TenantIdentitySettings, TenantSettingsPort } from '../application/identity-ports.js';

/**
 * A tenant's identity settings, resolved from configuration.
 *
 * Phase 2 has no tenant-administration module to store per-tenant overrides in — that arrives
 * with Organization in Phase 3 — so every tenant currently resolves to the deployment's
 * configured defaults. The *port* is what matters now: the use cases already ask for settings
 * rather than assuming them, so adding per-tenant storage later changes this file and nothing
 * else.
 *
 * Nothing here is hardcoded. Every value arrives from validated configuration, which is the
 * rule that keeps a product sold into several countries from having a country in its source
 * (00B). This is recorded as a known limitation rather than presented as tenant configuration
 * it is not yet.
 */
export class ConfiguredTenantSettings implements TenantSettingsPort {
  public constructor(private readonly defaults: TenantIdentitySettings) {}

  public settingsFor(): Promise<TenantIdentitySettings> {
    return Promise.resolve(this.defaults);
  }
}
