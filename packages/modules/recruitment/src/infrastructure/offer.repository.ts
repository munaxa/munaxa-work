import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { OfferState } from '../domain/offer.js';
import type { OfferStore } from '../application/recruitment-ports.js';

import {
  OFFER_COLUMNS,
  offerInsert,
  offerUpdate,
  toOffer,
  type OfferRow,
} from './pipeline-rows.js';
import { insertRow } from './row-writer.js';

/**
 * Offers, read in version order.
 *
 * Every version of an offer survives, so "what did we actually offer them, and what did they
 * accept" stays answerable long after the terms changed. The repository never deletes one and the
 * update mapping never touches the terms — only the status and the decision recorded against it.
 */
export class OfferRepository
  extends Repository<{ id: string; version: number }>
  implements OfferStore
{
  public constructor() {
    super('recruitment_offer');
  }

  public async byId(transaction: Transaction, id: string): Promise<OfferState | undefined> {
    const rows = await transaction.execute<OfferRow>(
      `select ${OFFER_COLUMNS} from recruitment_offer o
        where o.id = $1 and o.tenant_id = $2 and o.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toOffer(row);
  }

  public async forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly OfferState[]> {
    const rows = await transaction.execute<OfferRow>(
      `select ${OFFER_COLUMNS} from recruitment_offer o
        where o.tenant_id = $1 and o.application_id = $2 and o.deleted_at is null
        order by o.offer_version`,
      [transaction.tenantId, applicationId],
    );
    return rows.map(toOffer);
  }

  public async forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly OfferState[]> {
    if (applicationIds.length === 0) return [];

    const rows = await transaction.execute<OfferRow>(
      `select ${OFFER_COLUMNS} from recruitment_offer o
        where o.tenant_id = $1 and o.application_id = any($2::uuid[]) and o.deleted_at is null
        order by o.offer_version`,
      [transaction.tenantId, [...applicationIds]],
    );
    return rows.map(toOffer);
  }

  public async all(transaction: Transaction): Promise<readonly OfferState[]> {
    const rows = await transaction.execute<OfferRow>(
      `select ${OFFER_COLUMNS} from recruitment_offer o
        where o.tenant_id = $1 and o.deleted_at is null order by o.offer_number`,
      [transaction.tenantId],
    );
    return rows.map(toOffer);
  }

  public async insert(transaction: Transaction, state: OfferState): Promise<void> {
    await insertRow(transaction, this.table, offerInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: OfferState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, offerUpdate(state));
  }
}
