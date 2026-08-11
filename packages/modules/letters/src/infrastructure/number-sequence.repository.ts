import { auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { NumberSequenceStore } from '../application/letters-ports.js';

/**
 * The tenant-scoped, gapless counter behind a letter's reference number.
 *
 * Deliberately not a PostgreSQL sequence: a sequence is neither tenant-scoped nor transactional, and
 * an issue that rolled back would burn a number and leave a permanent gap in a customer's letter
 * register that nobody could explain (ADR-0039). Its own table rather than Employment's, because
 * the schema records that sharing a counter across modules would couple them (D-20).
 */
export class PostgresNumberSequenceRepository implements NumberSequenceStore {
  public async allocate(transaction: Transaction, seriesKey: string): Promise<number> {
    // The actor and the instant come from `auditForUpdate`, which reads the authenticated context
    // — the same source every other audit column in the product is written from.
    const audit = auditForUpdate(new Date());
    const rows = await transaction.execute<{ next_value: number | string }>(
      `insert into letter_number_sequence
         (tenant_id, series_key, next_value, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 2, $3, $4, $3, $4, 1)
       -- Matches letter_number_sequence_series_idx exactly. That index carries no partial
       -- predicate, and naming one here would leave no inference target and fail at runtime.
       on conflict (tenant_id, series_key)
       do update set next_value = letter_number_sequence.next_value + 1,
                     updated_at = $3,
                     updated_by = $4,
                     version = letter_number_sequence.version + 1
       returning next_value`,
      [transaction.tenantId, seriesKey, audit.updated_at, audit.updated_by],
    );
    const allocated = rows[0]?.next_value;

    if (allocated === undefined) {
      throw new Error('The letter number sequence returned no value.');
    }
    // The row holds the *next* value, so the number just allocated is one less. Returning the
    // stored value instead would skip the first number of every series.
    return Number(allocated) - 1;
  }
}
