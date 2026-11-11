import type { Pool } from 'pg';
import { PORTAL_KEYS } from '@work/identity';
import type { PortalKey, TenantIdentitySettings, TenantSettingsPort } from '@work/identity';

/**
 * A tenant's settings, read from what that tenant configured — falling back to the deployment's
 * defaults for a tenant that has not configured anything yet.
 *
 * **This is the adapter that closes the Phase 2 debt.** `ConfiguredTenantSettings` resolved every
 * tenant in a deployment to the same environment variables, so a hosting arrangement containing
 * a Riyadh customer and an Amman customer had to pick one language, one calendar and one
 * invitation validity for both. Organization is the module that finally has somewhere to keep
 * the answer, and the port Workforce Identity already asked through is what makes this a
 * replacement rather than a redesign — no identity use case changed.
 *
 * Three deliberate decisions:
 *
 * **It implements Identity's port, not its own.** `TenantSettingsPort` is part of Identity's
 * public contract, which is exactly what a contract is for. The alternative — a parallel
 * interface here and an adapter in the composition root translating between two identical
 * shapes — would be a seam that exists only to avoid admitting the dependency.
 *
 * **It reads outside the request's tenant context, and it must.** Identity resolves a tenant's
 * settings while establishing that tenant, and on the invitation path it asks about a tenant the
 * caller may not yet be acting in. So this uses its own pooled connection rather than the Unit of
 * Work, and passes the tenant explicitly. The exposure is narrow by construction and stated here
 * rather than left implicit: the query takes a tenant identifier the caller cannot choose (it
 * comes from a membership or an invitation the product itself wrote), and returns configuration
 * — a language, a calendar, a time zone — that is not personal data and discloses nothing about
 * anybody. See ADR-0036.
 *
 * **The named tenant is set for the read, because row-level security needs it.** `tenant_settings`
 * carries the forced `tenant_isolation` policy, so a query on a pooled connection with no
 * `app.tenant_id` reads zero rows for the runtime role (`work_app`, `NOBYPASSRLS`). Without the
 * transaction-local `set_config` below every tenant silently resolved to the deployment defaults
 * in a real deployment, while a test running as a superuser saw the stored row. The tenant set
 * is the one being asked about and nothing wider, so the read still returns that tenant's row
 * alone.
 *
 * **A missing row falls back rather than failing.** A tenant created five minutes ago has no
 * settings, and refusing to invite anybody into it until an administrator has visited a settings
 * screen would be a worse product. The fallback is the deployment's *validated configuration*,
 * which is where it came from before this class existed — so behaviour for an unconfigured
 * tenant is exactly Phase 2's, and configuring a tenant is what changes it.
 */
export class StoredTenantSettings implements TenantSettingsPort {
  public constructor(
    private readonly pool: Pool,
    private readonly deploymentDefaults: TenantIdentitySettings,
  ) {}

  public async settingsFor(tenantId: string): Promise<TenantIdentitySettings> {
    const row = await this.storedRow(tenantId);

    return row === undefined ? this.deploymentDefaults : merged(row, this.deploymentDefaults);
  }

  private async storedRow(tenantId: string): Promise<SettingsRow | undefined> {
    const client = await this.pool.connect();

    try {
      await client.query('begin read only');
      // Transaction-local, so the pooled connection carries no tenant into its next checkout.
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      const result = await client.query<SettingsRow>(
        `select language, calendar, time_zone, numerals, invitation_validity_days, default_portals
           from tenant_settings
          where tenant_id = $1 and deleted_at is null`,
        [tenantId],
      );
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface SettingsRow {
  readonly language: string;
  readonly calendar: string;
  readonly time_zone: string;
  readonly numerals: string;
  readonly invitation_validity_days: number;
  readonly default_portals: readonly string[];
}

/**
 * The row's values, narrowed rather than cast.
 *
 * The database constrains the calendar and the numerals with check constraints, so a row that
 * failed these tests could not exist — but `as TenantCalendar` would be a lie the type system
 * stops checking, and this way a schema that ever drifted degrades to the deployment default
 * instead of handing an unknown string to a date formatter.
 *
 * The portals are narrowed against `PORTAL_KEYS`, which is Identity's own list, published from
 * its contracts. Re-declaring the three portal names here would be a second copy of a closed set
 * — and the copy is what would be missing the fourth portal on the day one is added.
 */
const merged = (row: SettingsRow, defaults: TenantIdentitySettings): TenantIdentitySettings => ({
  language: row.language,
  calendar:
    row.calendar === 'hijri' || row.calendar === 'gregorian' ? row.calendar : defaults.calendar,
  timeZone: row.time_zone,
  numerals:
    row.numerals === 'western' || row.numerals === 'arabic-indic'
      ? row.numerals
      : defaults.numerals,
  invitationValidityDays: row.invitation_validity_days,
  defaultPortals: row.default_portals.filter(isPortalKey),
});

const isPortalKey = (value: string): value is PortalKey =>
  (PORTAL_KEYS as readonly string[]).includes(value);
