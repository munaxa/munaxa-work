import { Repository } from '@work/persistence';
import type { CalendarSystem, Transaction } from '@work/kernel';

import type { UserPreferenceStore } from '../application/identity-ports.js';
import type { UserPreferenceState } from '../domain/user-preference.js';
import type { NumeralSystem } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface PreferenceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly language: string;
  readonly calendar: string;
  readonly time_zone: string;
  readonly numerals: string;
  readonly version: number | string;
}

const COLUMNS = 'id, tenant_id, membership_id, language, calendar, time_zone, numerals, version';

const toState = (row: PreferenceRow): UserPreferenceState => ({
  id: row.id,
  tenantId: row.tenant_id,
  membershipId: row.membership_id,
  language: row.language,
  calendar: row.calendar as CalendarSystem,
  timeZone: row.time_zone,
  numerals: row.numerals as NumeralSystem,
  version: asVersion(row.version),
});

export class UserPreferenceRepository
  extends Repository<PreferenceRow & { id: string; version: number }>
  implements UserPreferenceStore
{
  public constructor() {
    super('user_preference');
  }

  public async forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<UserPreferenceState | undefined> {
    const rows = await transaction.execute<PreferenceRow>(
      `select ${COLUMNS} from user_preference
        where tenant_id = $1 and membership_id = $2 and deleted_at is null`,
      [transaction.tenantId, membershipId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async insert(transaction: Transaction, state: UserPreferenceState): Promise<void> {
    await insertRow(
      transaction,
      'user_preference',
      {
        id: state.id,
        tenant_id: state.tenantId,
        membership_id: state.membershipId,
        language: state.language,
        calendar: state.calendar,
        time_zone: state.timeZone,
        numerals: state.numerals,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: UserPreferenceState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      language: state.language,
      calendar: state.calendar,
      time_zone: state.timeZone,
      numerals: state.numerals,
    });
  }
}
