import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { EmploymentDirectoryPort } from '@work/relations';
import type { EmploymentView } from '@work/employment';

import type { Asking } from '../payroll/asking.js';

/** The permission the grant names. **No user holds it**; the grant is bounded and audited (ADR-0043). */
const EMPLOYMENT_READ = 'employment.read';

/**
 * One typed dispatch, local to this adapter.
 *
 * A local helper rather than a shared export, matching `documents-sources.ts`: a bare
 * `dispatcher.ask` narrows an object literal to `Query` and rejects the fields the query actually
 * carries, so each call site would need an assertion — and an assertion at every call site is an
 * assertion nobody reads.
 */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

/**
 * Whether an employment exists in this tenant — asked of Employment, through Employment's own
 * published read.
 *
 * **A boolean, and deliberately nothing more.** Relations needs to know that the employment a
 * violation is filed against is real and this tenant's. It does not need the person's name, their
 * status, their grade or their manager, and returning any of those would make this a directory a
 * disciplinary module has no business holding.
 *
 * **Another tenant's employment is `false`, indistinguishable from one that never existed.** The
 * read runs inside the caller's tenant context, so row-level security answers before this adapter
 * does — which is what stops `relations.record-violation` being used to enumerate another
 * organisation's workforce one identifier at a time.
 */
export class RelationsEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(employmentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'relations',
        operation: 'relations.record-violation',
        permits: [EMPLOYMENT_READ],
        reason: 'Confirming that the employment a violation is recorded against exists',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
        }),
    );

    return found.ok;
  }
}
