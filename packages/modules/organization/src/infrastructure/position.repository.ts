import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PositionQuery, PositionStore } from '../application/organization-ports.js';
import type { BilingualName, Metadata } from '../domain/organization-aggregate.js';
import type { OrganizationStatus, PositionCriticality } from '../domain/organization-vocabulary.js';
import type { PositionState } from '../domain/position.js';

import { asVersion, insertRow } from './row-writer.js';

interface PositionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly title: BilingualName;
  readonly description: BilingualName | null;
  readonly family: string | null;
  readonly grade: string | null;
  readonly criticality: string;
  readonly status: string;
  readonly metadata: Metadata;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, code, title, description, family, grade, criticality, status, metadata, effective_from, effective_to, version';

/**
 * The list filter. Every parameter is referenced, and typed, whether or not its filter is set, as
 * in the unit list: PostgreSQL refuses a parameter it cannot type. An unset filter is passed as
 * null and its clause is then true.
 *
 * The position id is equality on the primary key, never a pattern: it answers "does this exact
 * identifier exist in my tenant", and it is the one filter here that cannot be used to discover a
 * position the caller did not already name.
 */
const LIST_WHERE = `tenant_id = $1 and deleted_at is null
  and ($2::text is null or status = $2::text)
  and ($3::text is null or family = $3::text)
  and ($4::text is null
    or code ilike $4::text or title->>'en' ilike $4::text or title->>'ar' ilike $4::text)
  and ($5::uuid is null or id = $5::uuid)`;

/** The filter's parameters, $1 to $5; the page's limit and offset follow them in the list only. */
const filtersFor = (tenantId: string, query: PositionQuery): readonly unknown[] => [
  tenantId,
  query.status ?? null,
  query.family ?? null,
  query.term === undefined ? null : `%${query.term}%`,
  query.positionId ?? null,
];

const toState = (row: PositionRow): PositionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  title: row.title,
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.family === null ? {} : { family: row.family }),
  ...(row.grade === null ? {} : { grade: row.grade }),
  criticality: row.criticality as PositionCriticality,
  status: row.status as OrganizationStatus,
  metadata: row.metadata,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

export class PositionRepository
  extends Repository<PositionRow & { id: string; version: number }>
  implements PositionStore
{
  public constructor() {
    super('job_position');
  }

  public async byId(transaction: Transaction, id: string): Promise<PositionState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async byCode(transaction: Transaction, code: string): Promise<PositionState | undefined> {
    const rows = await transaction.execute<PositionRow>(
      `select ${COLUMNS} from job_position
        where tenant_id = $1 and lower(code) = lower($2) and deleted_at is null`,
      [transaction.tenantId, code],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /** Free text matches the code and the title in either language, as the unit search does. */
  public async list(
    transaction: Transaction,
    query: PositionQuery,
  ): Promise<{ readonly items: readonly PositionState[]; readonly total: number }> {
    const filters = filtersFor(transaction.tenantId, query);

    const rows = await transaction.execute<PositionRow>(
      `select ${COLUMNS} from job_position where ${LIST_WHERE}
        order by code limit $6 offset $7`,
      [...filters, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from job_position where ${LIST_WHERE}`,
      filters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async all(transaction: Transaction): Promise<readonly PositionState[]> {
    const rows = await transaction.execute<PositionRow>(
      `select ${COLUMNS} from job_position
        where tenant_id = $1 and deleted_at is null order by code`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: PositionState): Promise<void> {
    await insertRow(
      transaction,
      'job_position',
      {
        id: state.id,
        tenant_id: state.tenantId,
        code: state.code,
        title: JSON.stringify(state.title),
        description: state.description === undefined ? null : JSON.stringify(state.description),
        family: state.family ?? null,
        grade: state.grade ?? null,
        criticality: state.criticality,
        status: state.status,
        metadata: JSON.stringify(state.metadata),
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: PositionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      title: JSON.stringify(state.title),
      description: state.description === undefined ? null : JSON.stringify(state.description),
      family: state.family ?? null,
      grade: state.grade ?? null,
      criticality: state.criticality,
      status: state.status,
      metadata: JSON.stringify(state.metadata),
      effective_to: state.effectiveTo ?? null,
    });
  }
}
