import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { BusinessProfileStore } from '../application/identity-ports.js';
import type { BusinessProfileState } from '../domain/business-profile.js';

import { asVersion, insertRow } from './row-writer.js';

interface ProfileRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly display_name: Record<string, string>;
  readonly job_title: Record<string, string> | null;
  readonly business_email: string | null;
  readonly business_phone: string | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, membership_id, display_name, job_title, business_email, business_phone, version';

const toState = (row: ProfileRow): BusinessProfileState => ({
  id: row.id,
  tenantId: row.tenant_id,
  membershipId: row.membership_id,
  displayName: row.display_name,
  ...(row.job_title === null ? {} : { jobTitle: row.job_title }),
  ...(row.business_email === null ? {} : { businessEmail: row.business_email }),
  ...(row.business_phone === null ? {} : { businessPhone: row.business_phone }),
  version: asVersion(row.version),
});

export class BusinessProfileRepository
  extends Repository<ProfileRow & { id: string; version: number }>
  implements BusinessProfileStore
{
  public constructor() {
    super('business_profile');
  }

  public async forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<BusinessProfileState | undefined> {
    const rows = await transaction.execute<ProfileRow>(
      `select ${COLUMNS} from business_profile
        where tenant_id = $1 and membership_id = $2 and deleted_at is null`,
      [transaction.tenantId, membershipId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /**
   * Name search across every language the profile carries.
   *
   * Searching the JSON values rather than a single column is what makes "بدر" and "Badr" find
   * the same person. A schema with `display_name_en` and `display_name_ar` would have needed a
   * third column the day a tenant added French, and every query rewritten with it.
   */
  public async search(
    transaction: Transaction,
    term: string,
    limit: number,
  ): Promise<readonly BusinessProfileState[]> {
    const rows = await transaction.execute<ProfileRow>(
      `select ${COLUMNS} from business_profile
        where tenant_id = $1 and deleted_at is null
          and exists (
            select 1 from jsonb_each_text(display_name) as name(language, text)
            where name.text ilike '%' || $2 || '%'
          )
        order by id desc
        limit $3`,
      [transaction.tenantId, term, limit],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: BusinessProfileState): Promise<void> {
    await insertRow(
      transaction,
      'business_profile',
      {
        id: state.id,
        tenant_id: state.tenantId,
        membership_id: state.membershipId,
        display_name: JSON.stringify(state.displayName),
        job_title: state.jobTitle === undefined ? null : JSON.stringify(state.jobTitle),
        business_email: state.businessEmail ?? null,
        business_phone: state.businessPhone ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: BusinessProfileState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      display_name: JSON.stringify(state.displayName),
      job_title: state.jobTitle === undefined ? null : JSON.stringify(state.jobTitle),
      business_email: state.businessEmail ?? null,
      business_phone: state.businessPhone ?? null,
    });
  }
}
