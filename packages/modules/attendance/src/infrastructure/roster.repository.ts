import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { RosterEntryState } from '../domain/roster-entry.js';
import type { PolicyState } from '../domain/attendance-policy.js';
import type { PolicyStore, RosterStore } from '../application/attendance-ports.js';

import {
  ROSTER_COLUMNS,
  rosterInsert,
  toRosterEntry,
  type RosterEntryRow,
} from './definition-rows.js';
import {
  POLICY_COLUMNS,
  policyInsert,
  policyUpdate,
  toPolicy,
  type PolicyRow,
} from './record-rows.js';
import { insertRow } from './row-writer.js';

/**
 * Roster entries and attendance policies, in PostgreSQL.
 *
 * `remove` is a **soft** delete, and that is the whole design of rostering here: replacing an entry
 * supersedes it rather than overwriting it, so "who moved the rota, and when" stays answerable after
 * somebody disputes a month. The partial unique index ignores deleted rows, which is what lets the
 * replacement land on the same `(employment, date)`.
 */
export class RosterRepository
  extends Repository<{ id: string; version: number }>
  implements RosterStore
{
  public constructor() {
    super('attendance_roster_entry');
  }

  public async byId(transaction: Transaction, id: string): Promise<RosterEntryState | undefined> {
    const rows = await transaction.execute<RosterEntryRow>(
      `select ${ROSTER_COLUMNS} from attendance_roster_entry r
        where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRosterEntry(row);
  }

  public async on(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<RosterEntryState | undefined> {
    const rows = await transaction.execute<RosterEntryRow>(
      `select ${ROSTER_COLUMNS} from attendance_roster_entry r
        where r.tenant_id = $1 and r.employment_id = $2 and r.on_date = $3::date
          and r.deleted_at is null`,
      [transaction.tenantId, employmentId, onDate],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRosterEntry(row);
  }

  /** A window of the rota, for one person or for everybody. The roster screen's only read. */
  public async between(
    transaction: Transaction,
    from: string,
    to: string,
    employmentId?: string,
  ): Promise<readonly RosterEntryState[]> {
    const rows = await transaction.execute<RosterEntryRow>(
      `select ${ROSTER_COLUMNS} from attendance_roster_entry r
        where r.tenant_id = $1 and r.on_date between $2::date and $3::date and r.deleted_at is null
          and ($4::uuid is null or r.employment_id = $4::uuid)
        order by r.on_date, r.employment_id`,
      [transaction.tenantId, from, to, employmentId ?? null],
    );
    return rows.map(toRosterEntry);
  }

  public async insert(transaction: Transaction, state: RosterEntryState): Promise<void> {
    await insertRow(transaction, this.table, rosterInsert(state), new Date());
  }

  public async remove(transaction: Transaction, id: string, expected: number): Promise<void> {
    await this.softDeleteRow(transaction, id, expected);
  }
}

/**
 * Attendance policies, in PostgreSQL.
 *
 * `published` returns every published policy and lets the domain pick the one in force on a date.
 * The alternative — a `where $date between effective_from and effective_to` — would put the
 * effective-dating rule in SQL as well as in `policyOn`, and two places that decide which policy
 * applies eventually decide differently.
 */
export class PolicyRepository
  extends Repository<{ id: string; version: number }>
  implements PolicyStore
{
  public constructor() {
    super('attendance_policy');
  }

  public async byId(transaction: Transaction, id: string): Promise<PolicyState | undefined> {
    const rows = await transaction.execute<PolicyRow>(
      `select ${POLICY_COLUMNS} from attendance_policy p
        where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPolicy(row);
  }

  public async published(transaction: Transaction): Promise<readonly PolicyState[]> {
    const rows = await transaction.execute<PolicyRow>(
      `select ${POLICY_COLUMNS} from attendance_policy p
        where p.tenant_id = $1 and p.status = 'published' and p.deleted_at is null
        order by p.effective_from desc, p.version_number desc`,
      [transaction.tenantId],
    );
    return rows.map(toPolicy);
  }

  public async all(transaction: Transaction): Promise<readonly PolicyState[]> {
    const rows = await transaction.execute<PolicyRow>(
      `select ${POLICY_COLUMNS} from attendance_policy p
        where p.tenant_id = $1 and p.deleted_at is null
        order by p.effective_from desc, p.version_number desc`,
      [transaction.tenantId],
    );
    return rows.map(toPolicy);
  }

  public async insert(transaction: Transaction, state: PolicyState): Promise<void> {
    await insertRow(transaction, this.table, policyInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PolicyState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, policyUpdate(state));
  }
}
