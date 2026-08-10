import { uuidV7, type Transaction } from '@work/kernel';

import { snapshotDigest, type EmploymentSnapshot } from '../domain/payroll-snapshot.js';
import type { SnapshotStore, StoredDigests } from '../application/payroll-ports.js';
import { snapshotDigests, snapshotState, type SnapshotRow } from './run-rows.js';

/**
 * The input snapshot — the table ADR-0064 is about.
 *
 * A whole batch goes in as **one multi-row insert**, and reconciliation reads the digests alone
 * without loading four `jsonb` documents per employment.
 */

export class PostgresSnapshotRepository implements SnapshotStore {
  public async forRun(
    transaction: Transaction,
    runId: string,
  ): Promise<readonly EmploymentSnapshot[]> {
    const rows = await transaction.execute<SnapshotRow>(
      `select * from payroll_input_snapshot
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
         order by employment_id`,
      [transaction.tenantId, runId],
    );

    return rows.map(snapshotState);
  }

  public async forEmployment(
    transaction: Transaction,
    runId: string,
    employmentId: string,
  ): Promise<EmploymentSnapshot | undefined> {
    const rows = await transaction.execute<SnapshotRow>(
      `select * from payroll_input_snapshot
         where tenant_id = $1 and payroll_run_id = $2 and employment_id = $3 and deleted_at is null`,
      [transaction.tenantId, runId, employmentId],
    );

    return rows[0] === undefined ? undefined : snapshotState(rows[0]);
  }

  /**
   * The digests alone, **without the payloads**.
   *
   * Reconciliation compares fingerprints; loading four `jsonb` documents per employment to do that
   * would make the cheap half of the design expensive. At a hundred thousand employments this is
   * the difference between a few megabytes and a few gigabytes.
   */
  public async digestsFor(
    transaction: Transaction,
    runId: string,
  ): Promise<ReadonlyMap<string, StoredDigests>> {
    const rows = await transaction.execute<SnapshotRow>(
      `select employment_id, employment_version, compensation_digest, attendance_digest,
              attendance_sequence, leave_digest, snapshot_digest
         from payroll_input_snapshot
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null`,
      [transaction.tenantId, runId],
    );

    return new Map(rows.map((row) => [row.employment_id, snapshotDigests(row)]));
  }

  /**
   * A whole batch in **one multi-row insert**.
   *
   * Never a statement per employment: at five hundred per batch that is five hundred round trips
   * where one will do, and the difference is the whole of D-14's answer at scale.
   */
  public async insertMany(
    transaction: Transaction,
    runId: string,
    snapshots: readonly EmploymentSnapshot[],
  ): Promise<void> {
    if (snapshots.length === 0) return;

    const now = new Date();
    const columns = [
      'id',
      'tenant_id',
      'payroll_run_id',
      'employment_id',
      'employment_facts',
      'compensation_facts',
      'attendance_facts',
      'leave_facts',
      'employment_version',
      'compensation_digest',
      'compensation_version',
      'attendance_digest',
      'attendance_sequence',
      'leave_digest',
      'leave_version',
      'snapshot_digest',
      'eligibility_rule_version',
      'captured_at',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
      'version',
    ];
    const parameters: unknown[] = [];
    const tuples = snapshots.map((snapshot, index) => {
      parameters.push(...rowFor(snapshot, runId, transaction.tenantId, now));
      return `(${columns.map((_, column) => `$${String(index * columns.length + column + 1)}`).join(', ')})`;
    });

    await transaction.execute(
      `insert into payroll_input_snapshot (${columns.join(', ')}) values ${tuples.join(', ')}`,
      parameters,
    );
  }

  /** See `SnapshotStore.clearEmployments`: a recalculation replaces what it consumed. */
  public async clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void> {
    if (employmentIds.length === 0) return;
    await transaction.execute(
      `delete from payroll_input_snapshot
         where tenant_id = $1 and payroll_run_id = $2 and employment_id = any($3::uuid[])
           and finalized_at is null`,
      [transaction.tenantId, runId, employmentIds],
    );
  }
}

/**
 * One snapshot row's values, in the column order above.
 *
 * `jsonb` payloads are serialized with every monetary amount as a **decimal string** — `bigint` has
 * no JSON representation, and a `Number` here would silently mangle anything above 2^53. The
 * mapper parses them back with `BigInt`, and the exactness suite proves the round trip.
 */
const rowFor = (
  snapshot: EmploymentSnapshot,
  runId: string,
  tenantId: string,
  now: Date,
): readonly unknown[] => [
  uuidV7(),
  tenantId,
  runId,
  snapshot.employmentId,
  ...payloads(snapshot),
  ...versions(snapshot),
  snapshotDigest(snapshot),
  0,
  snapshot.capturedAt,
  now,
  SYSTEM_ACTOR,
  now,
  SYSTEM_ACTOR,
  1,
];

/** The batch insert writes its own audit columns, so the actor is the module rather than a human. */
const SYSTEM_ACTOR = 'system:payroll';

const payloads = (snapshot: EmploymentSnapshot): readonly unknown[] => [
  jsonOrNull(snapshot.employment),
  jsonOrNull(snapshot.compensation === undefined ? undefined : serialized(snapshot.compensation)),
  jsonOrNull(snapshot.attendance),
  jsonOrNull(snapshot.leave),
];

/**
 * The versions and digests, beside the payloads.
 *
 * An absent source leaves its column `null`, which is what lets reconciliation tell "asked and
 * there was nothing" apart from "could not ask" — the digest of a snapshot taken during an outage
 * differs from one taken when the source answered emptily.
 */
const versions = (snapshot: EmploymentSnapshot): readonly unknown[] => [
  ...(snapshot.employment === undefined ? [null] : [snapshot.employment.version]),
  ...(snapshot.compensation === undefined
    ? [null, null]
    : [snapshot.compensation.inputsDigest, snapshot.compensation.calculationVersion]),
  ...(snapshot.attendance === undefined
    ? [null, null]
    : [snapshot.attendance.inputsDigest, snapshot.attendance.sequence]),
  ...(snapshot.leave === undefined
    ? [null, null]
    : [snapshot.leave.inputsDigest, snapshot.leave.calculationVersion]),
];

const jsonOrNull = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);

/** Amounts as decimal strings, so `jsonb` holds them exactly. */
const serialized = (compensation: NonNullable<EmploymentSnapshot['compensation']>): unknown => ({
  ...compensation,
  currencies: compensation.currencies.map((block) => ({
    ...block,
    recurring: block.recurring.map((component) => ({
      ...component,
      amount: { ...component.amount, amountMinor: component.amount.amountMinor.toString() },
    })),
    oneTime: block.oneTime.map((item) => ({
      ...item,
      amount: { ...item.amount, amountMinor: item.amount.amountMinor.toString() },
    })),
  })),
});
