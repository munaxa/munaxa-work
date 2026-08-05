import { ConcurrencyException, TenantIsolationException } from '@work/kernel';

/**
 * An in-memory repository that keeps the guarantees the real base class makes.
 *
 * A fake that is more permissive than production is worse than no fake: every test passes and
 * the difference appears in production. So this one refuses a cross-tenant read, refuses a
 * stale write, and hides soft-deleted rows — the three behaviours a module is most likely to
 * assume and most likely to get wrong.
 */

export interface FakeRow {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly deletedAt?: Date;
}

export class FakeRepository<TRow extends FakeRow> {
  private readonly rows = new Map<string, TRow>();

  public constructor(private readonly name = 'fake') {}

  public seed(row: TRow): void {
    this.rows.set(row.id, row);
  }

  public find(tenantId: string, id: string): TRow | undefined {
    const row = this.rows.get(id);

    if (row === undefined || row.tenantId !== tenantId) return undefined;
    return row.deletedAt === undefined ? row : undefined;
  }

  /** Reads including deleted rows. Administrative queries only, as in production. */
  public findIncludingDeleted(tenantId: string, id: string): TRow | undefined {
    const row = this.rows.get(id);
    return row?.tenantId === tenantId ? row : undefined;
  }

  public save(tenantId: string, row: TRow, expectedVersion: number): TRow {
    const existing = this.rows.get(row.id);

    if (existing !== undefined && existing.tenantId !== tenantId) {
      throw new TenantIsolationException(this.name);
    }
    if (existing !== undefined && existing.version !== expectedVersion) {
      throw new ConcurrencyException(this.name, expectedVersion, existing.version);
    }
    const saved = { ...row, version: expectedVersion + 1 };
    this.rows.set(row.id, saved);
    return saved;
  }

  public softDelete(tenantId: string, id: string, deletedAt: Date): void {
    const row = this.find(tenantId, id);

    if (row === undefined) throw new TenantIsolationException(this.name);
    this.rows.set(id, { ...row, deletedAt, version: row.version + 1 });
  }

  public all(tenantId: string): readonly TRow[] {
    return [...this.rows.values()].filter(
      (row) => row.tenantId === tenantId && row.deletedAt === undefined,
    );
  }
}
