import { Repository, auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type {
  ApprovalDecisionStore,
  IssuedLetterStore,
  LetterFilters,
  LetterRequestStore,
  Page,
  Paged,
} from '../application/letters-ports.js';
import {
  decisionState,
  decisionValues,
  issuedLetterState,
  issuedLetterValues,
  requestState,
  requestValues,
  type ApprovalDecisionRow,
  type IssuedLetterRow,
  type LetterRequestRow,
} from './letter-rows.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/** Requests, issued letters, approval decisions and the reference-number counter. */

export class PostgresLetterRequestRepository
  extends Repository<LetterRequestRow & { version: number }>
  implements LetterRequestStore
{
  public constructor() {
    super('letter_request');
  }

  public async byId(transaction: Transaction, id: string): Promise<LetterRequestState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : requestState(row);
  }

  public search(
    transaction: Transaction,
    filters: LetterFilters,
    paged: Paged,
  ): Promise<Page<LetterRequestState>> {
    const predicate = predicateFor('r', transaction.tenantId, requestFilters(filters));

    return pageOf<LetterRequestRow, LetterRequestState>(
      transaction,
      {
        select: `select r.* from letter_request r
                   where ${predicate.clause}
                   order by r.requested_at desc, r.id desc
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from letter_request r where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      requestState,
    );
  }

  public insert(transaction: Transaction, state: LetterRequestState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      requestValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: LetterRequestState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.letterRequestId,
      expected,
      mutable(requestValues(state, transaction.tenantId)),
    );
  }
}

const requestFilters = (filters: LetterFilters): readonly Filter[] => [
  { column: 'r.letter_template_id', value: filters.letterTemplateId },
  { column: 'r.employment_id', value: filters.employmentId },
  { column: 'r.person_id', value: filters.personId },
  { column: 'r.status', value: filters.status },
];

/**
 * An issued letter: insert, read, and one supersession stamp.
 *
 * **It does not extend `Repository`.** That base provides `updateRow` and `softDeleteRow`, and
 * neither may exist here: somebody may be holding a printed copy of this letter, and a register
 * whose rows can be edited afterwards cannot answer for what it issued. A correction is a *new*
 * letter that supersedes this one. A trigger refuses the same operations from any path including
 * SQL nobody wrote in TypeScript.
 */
export class PostgresIssuedLetterRepository implements IssuedLetterStore {
  public async byId(transaction: Transaction, id: string): Promise<IssuedLetterState | undefined> {
    const rows = await transaction.execute<IssuedLetterRow>(
      `select * from letter_issued
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : issuedLetterState(rows[0]);
  }

  public async byRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<IssuedLetterState | undefined> {
    const rows = await transaction.execute<IssuedLetterRow>(
      `select * from letter_issued
         where tenant_id = $1 and letter_request_id = $2 and deleted_at is null
         order by issued_at
         limit 1`,
      [transaction.tenantId, requestId],
    );

    return rows[0] === undefined ? undefined : issuedLetterState(rows[0]);
  }

  /** The third-party lookup. Takes the token and nothing else, and is still tenant-scoped. */
  public async byVerificationToken(
    transaction: Transaction,
    token: string,
  ): Promise<IssuedLetterState | undefined> {
    const rows = await transaction.execute<IssuedLetterRow>(
      `select * from letter_issued
         where tenant_id = $1 and verification_token = $2 and deleted_at is null`,
      [transaction.tenantId, token],
    );

    return rows[0] === undefined ? undefined : issuedLetterState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: LetterFilters,
    paged: Paged,
  ): Promise<Page<IssuedLetterState>> {
    const predicate = predicateFor('l', transaction.tenantId, issuedFilters(filters));

    return pageOf<IssuedLetterRow, IssuedLetterState>(
      transaction,
      {
        select: `select l.* from letter_issued l
                   where ${predicate.clause}
                   order by l.issued_at desc, l.id desc
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from letter_issued l where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      issuedLetterState,
    );
  }

  public insert(transaction: Transaction, state: IssuedLetterState): Promise<void> {
    return insertRow(
      transaction,
      'letter_issued',
      issuedLetterValues(state, transaction.tenantId),
      new Date(),
    );
  }

  /**
   * The only permitted touch: recording that a correction replaced this letter.
   *
   * `superseded_by_id is null` in the predicate makes it write-once, and the trigger refuses a
   * second one anyway. The letter's content — its reference, its values, its date — is untouched,
   * because that is exactly what somebody may be holding a copy of.
   */
  public async supersede(
    transaction: Transaction,
    id: string,
    supersededById: string,
    moment: Date,
  ): Promise<void> {
    const audit = auditForUpdate(moment);

    await transaction.execute(
      `update letter_issued
          set superseded_by_id = $1, superseded_at = $2, updated_at = $3, updated_by = $4,
              version = version + 1
        where id = $5 and tenant_id = $6 and superseded_by_id is null`,
      [supersededById, moment, audit.updated_at, audit.updated_by, id, transaction.tenantId],
    );
  }
}

const issuedFilters = (filters: LetterFilters): readonly Filter[] => [
  { column: 'l.letter_template_id', value: filters.letterTemplateId },
  { column: 'l.employment_id', value: filters.employmentId },
  { column: 'l.person_id', value: filters.personId },
];

/** Approval decisions: insert and read. A wrong decision is reversed, never edited. */
export class PostgresApprovalDecisionRepository implements ApprovalDecisionStore {
  public async forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly ApprovalDecisionState[]> {
    const rows = await transaction.execute<ApprovalDecisionRow>(
      `select * from letter_approval_decision
         where tenant_id = $1 and letter_request_id = $2 and deleted_at is null
         order by sequence`,
      [transaction.tenantId, requestId],
    );

    return rows.map(decisionState);
  }

  public insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void> {
    return insertRow(
      transaction,
      'letter_approval_decision',
      decisionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
