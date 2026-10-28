import { parseEntitlementSnapshot, type EntitlementSnapshot } from '@munaxa/licensing';
import type { UnitOfWork } from '@work/kernel';

/** The `licensing_state` port's token. */
export const LICENSING_STATE_STORE = Symbol('LICENSING_STATE_STORE');

export interface StoredLicensingState {
  /** The last snapshot verified for the tenant; `null` when the source said "no subscription". */
  readonly snapshot: EntitlementSnapshot | null;
  readonly lastObservedAt: Date;
}

/**
 * What this deployment last verified about a tenant's entitlements, kept across restarts — ADR-0079.
 *
 * Read and written inside the request's own tenant transaction, under the table's row-level
 * security, so a tenant's state is reachable only in that tenant's context.
 */
export interface LicensingStateStore {
  read(tenantId: string): Promise<StoredLicensingState | null>;
  /** `lastObservedAt` only moves forward: the stored value is the later of the two. */
  write(
    tenantId: string,
    state: {
      readonly snapshot: EntitlementSnapshot | null;
      readonly source: 'LICENSE_FILE' | 'CONTROL_PLANE';
      readonly observedAt: Date;
    },
  ): Promise<void>;
}

const WRITER = 'system:licensing';

export class PostgresLicensingStateStore implements LicensingStateStore {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public async read(tenantId: string): Promise<StoredLicensingState | null> {
    const rows = await this.unitOfWork.execute((transaction) => {
      // The unit of work is the current context's tenant; asked about any other, it knows nothing.
      if (transaction.tenantId !== tenantId) return Promise.resolve([]);
      return transaction.execute<{ snapshot: unknown; last_observed_at: Date }>(
        `select snapshot, last_observed_at from licensing_state
          where tenant_id = $1 and deleted_at is null`,
        [tenantId],
      );
    });
    const row = rows[0];
    if (row === undefined) return null;
    // A stored snapshot that no longer satisfies the contract is treated as none — never as a grant.
    const parsed = row.snapshot === null ? null : parseEntitlementSnapshot(row.snapshot);
    return {
      snapshot: parsed !== null && parsed.ok ? parsed.snapshot : null,
      lastObservedAt: row.last_observed_at,
    };
  }

  public async write(
    tenantId: string,
    state: Parameters<LicensingStateStore['write']>[1],
  ): Promise<void> {
    await this.unitOfWork.execute(async (transaction) => {
      if (transaction.tenantId !== tenantId) return;
      await transaction.execute(
        `insert into licensing_state
           (tenant_id, snapshot, source, last_observed_at,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2::jsonb, $3, $4, now(), $5, now(), $5, 1)
         on conflict (tenant_id) do update set
           snapshot = excluded.snapshot,
           source = excluded.source,
           last_observed_at = greatest(licensing_state.last_observed_at, excluded.last_observed_at),
           updated_at = now(),
           updated_by = excluded.updated_by,
           version = licensing_state.version + 1`,
        [
          tenantId,
          state.snapshot === null ? null : JSON.stringify(state.snapshot),
          state.source,
          state.observedAt,
          WRITER,
        ],
      );
    });
  }
}

/** The same forward-only rule, in memory: for tests, and for nothing else. */
export class MemoryLicensingStateStore implements LicensingStateStore {
  public readonly rows = new Map<string, StoredLicensingState>();

  public read(tenantId: string): Promise<StoredLicensingState | null> {
    return Promise.resolve(this.rows.get(tenantId) ?? null);
  }

  public write(
    tenantId: string,
    state: Parameters<LicensingStateStore['write']>[1],
  ): Promise<void> {
    const previous = this.rows.get(tenantId)?.lastObservedAt;
    const lastObservedAt =
      previous !== undefined && previous > state.observedAt ? previous : state.observedAt;
    this.rows.set(tenantId, { snapshot: state.snapshot, lastObservedAt });
    return Promise.resolve();
  }
}
