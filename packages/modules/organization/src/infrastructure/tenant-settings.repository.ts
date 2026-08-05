import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { TenantSettingsStore } from '../application/organization-ports.js';
import type {
  TenantCalendar,
  TenantNumerals,
  TenantSettingsState,
} from '../domain/tenant-settings.js';

import { asVersion, insertRow } from './row-writer.js';

interface SettingsRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly language: string;
  readonly calendar: string;
  readonly time_zone: string;
  readonly numerals: string;
  readonly invitation_validity_days: number;
  readonly default_portals: readonly string[];
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, language, calendar, time_zone, numerals, invitation_validity_days, default_portals, version';

const toState = (row: SettingsRow): TenantSettingsState => ({
  id: row.id,
  tenantId: row.tenant_id,
  language: row.language,
  calendar: row.calendar as TenantCalendar,
  timeZone: row.time_zone,
  numerals: row.numerals as TenantNumerals,
  invitationValidityDays: row.invitation_validity_days,
  defaultPortals: row.default_portals,
  version: asVersion(row.version),
});

export class TenantSettingsRepository
  extends Repository<SettingsRow & { id: string; version: number }>
  implements TenantSettingsStore
{
  public constructor() {
    super('tenant_settings');
  }

  /**
   * One row per tenant, found by tenant rather than by identifier.
   *
   * The `tenantId` argument is checked against the transaction's tenant rather than trusted.
   * Row-level security would refuse a cross-tenant read anyway, and this makes the refusal
   * explicit at the boundary rather than an empty result the caller has to interpret — a caller
   * asking about a tenant that is not the one in context has a bug, and silence hides it.
   */
  public async forTenant(
    transaction: Transaction,
    tenantId: string,
  ): Promise<TenantSettingsState | undefined> {
    if (tenantId !== transaction.tenantId) return undefined;

    const rows = await transaction.execute<SettingsRow>(
      `select ${COLUMNS} from tenant_settings where tenant_id = $1 and deleted_at is null`,
      [tenantId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async insert(transaction: Transaction, state: TenantSettingsState): Promise<void> {
    await insertRow(
      transaction,
      'tenant_settings',
      {
        id: state.id,
        tenant_id: state.tenantId,
        language: state.language,
        calendar: state.calendar,
        time_zone: state.timeZone,
        numerals: state.numerals,
        invitation_validity_days: state.invitationValidityDays,
        default_portals: [...state.defaultPortals],
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: TenantSettingsState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      language: state.language,
      calendar: state.calendar,
      time_zone: state.timeZone,
      numerals: state.numerals,
      invitation_validity_days: state.invitationValidityDays,
      default_portals: [...state.defaultPortals],
    });
  }
}
