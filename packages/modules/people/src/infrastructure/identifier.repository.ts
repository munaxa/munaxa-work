import type { Transaction } from '@work/kernel';

import type { PersonIdentifierState } from '../domain/person-identifier.js';
import type { PersonContactState } from '../domain/person-contact.js';
import type { ContactStore, IdentifierStore } from '../application/people-ports.js';

import { ChildRepository, type ChildTable } from './child.repository.js';
import { CONTACT_TABLE, type ContactRow } from './contact-tables.js';
import { asVersion, civilDateColumn } from './row-writer.js';

/**
 * The two child tables that carry an extra lookup, and the reason they are not the generic
 * repository.
 *
 * Duplicate detection is three indexed lookups rather than a scan — the digests, the normalized
 * contact values, and the people sharing a date of birth. Two of the three are here. Comparing a
 * new person against every existing one would be linear in the size of the register on every
 * single create, and the check that becomes slow is the check that gets switched off.
 */

interface IdentifierRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_id: string;
  readonly identifier_type: string;
  readonly value: string;
  readonly match_key: string;
  readonly issuing_country: string | null;
  readonly issued_on: string | null;
  readonly expires_on: string | null;
  readonly is_primary: boolean;
  readonly withdrawn_at: Date | null;
  readonly version: number | string;
}

const IDENTIFIER_TABLE: ChildTable<PersonIdentifierState, IdentifierRow> = {
  table: 'person_identifier',
  columns: `id, tenant_id, person_id, identifier_type, value, match_key, issuing_country, ${civilDateColumn('issued_on')}, ${civilDateColumn('expires_on')}, is_primary, withdrawn_at, version`,
  order: 'identifier_type, is_primary desc',
  toState: (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    personId: row.person_id,
    identifierType: row.identifier_type,
    value: row.value,
    matchKey: row.match_key,
    ...(row.issuing_country === null ? {} : { issuingCountry: row.issuing_country }),
    ...(row.issued_on === null ? {} : { issuedOn: row.issued_on }),
    ...(row.expires_on === null ? {} : { expiresOn: row.expires_on }),
    isPrimary: row.is_primary,
    ...(row.withdrawn_at === null ? {} : { withdrawnAt: row.withdrawn_at }),
    version: asVersion(row.version),
  }),
  toInsert: (state) => ({
    id: state.id,
    tenant_id: state.tenantId,
    person_id: state.personId,
    identifier_type: state.identifierType,
    value: state.value,
    match_key: state.matchKey,
    issuing_country: state.issuingCountry ?? null,
    issued_on: state.issuedOn ?? null,
    expires_on: state.expiresOn ?? null,
    is_primary: state.isPrimary,
    withdrawn_at: state.withdrawnAt ?? null,
  }),
  // Neither the value nor the match key is in the update set. A different number is a different
  // document — a renewed passport is a new identifier and a withdrawal of the old one (AD-009).
  toUpdate: (state) => ({
    issued_on: state.issuedOn ?? null,
    expires_on: state.expiresOn ?? null,
    is_primary: state.isPrimary,
    withdrawn_at: state.withdrawnAt ?? null,
  }),
};

export class IdentifierRepository
  extends ChildRepository<PersonIdentifierState, IdentifierRow>
  implements IdentifierStore
{
  public constructor() {
    super(IDENTIFIER_TABLE);
  }

  /**
   * Who already holds any of these digests.
   *
   * Withdrawn documents are excluded, so a renewed passport does not flag its own holder against
   * themselves — and so a number an authority reissued to somebody else can be recorded.
   */
  public async byMatchKeys(
    transaction: Transaction,
    matchKeys: readonly string[],
  ): Promise<readonly PersonIdentifierState[]> {
    if (matchKeys.length === 0) return [];

    const rows = await transaction.execute<IdentifierRow>(
      `select ${IDENTIFIER_TABLE.columns} from person_identifier
        where tenant_id = $1 and match_key = any($2::text[])
          and withdrawn_at is null and deleted_at is null`,
      [transaction.tenantId, [...matchKeys]],
    );
    return rows.map((row) => IDENTIFIER_TABLE.toState(row));
  }
}

export class ContactRepository
  extends ChildRepository<PersonContactState, ContactRow>
  implements ContactStore
{
  public constructor() {
    // The generic definition, plus the one lookup duplicate detection needs.
    super(CONTACT_TABLE);
  }

  /**
   * Who already holds any of these normalized values.
   *
   * Closed periods are included deliberately: a number somebody used to have is still evidence
   * that two records are one human being, and excluding history would make the check weakest for
   * exactly the long-tenured people a duplicate most often affects.
   */
  public async byValues(
    transaction: Transaction,
    values: readonly string[],
  ): Promise<readonly PersonContactState[]> {
    if (values.length === 0) return [];

    const rows = await transaction.execute<ContactRow>(
      `select ${CONTACT_TABLE.columns} from person_contact
        where tenant_id = $1 and value = any($2::text[]) and deleted_at is null`,
      [transaction.tenantId, [...values]],
    );
    return rows.map((row) => CONTACT_TABLE.toState(row));
  }
}
